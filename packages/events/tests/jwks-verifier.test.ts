import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { JwksVerifier, LocalEd25519Signer } from "../src/signer.js";

// --- helpers ----------------------------------------------------------------

async function makeKidA() {
  const signer = await LocalEd25519Signer.fromSeedHex("a".repeat(64), "kid-A");
  const bin = String.fromCharCode(...signer.publicKeyBytes());
  const x = btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return { signer, jwksEntry: { kty: "OKP", crv: "Ed25519", kid: "kid-A", x } };
}

function fakeFetch(
  responder: (url: string, init?: RequestInit) => Promise<Response> | Response,
): typeof fetch {
  return ((url: string, init?: RequestInit) =>
    Promise.resolve(responder(url, init))) as unknown as typeof fetch;
}

function jsonResp(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

// --- F-001: fetch timeout --------------------------------------------------

describe("JwksVerifier — fetch timeout (F-001 BB#227)", () => {
  it("aborts when the JWKS endpoint hangs longer than timeoutMs", async () => {
    let abortFired = false;
    const hangingFetch: typeof fetch = ((url: string, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        const signal = init?.signal;
        signal?.addEventListener("abort", () => {
          abortFired = true;
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    }) as unknown as typeof fetch;

    await assert.rejects(
      JwksVerifier.fromUrl("https://hung.example/jwks", {
        timeoutMs: 50,
        fetchImpl: hangingFetch,
      }),
      (err: Error) => err.name === "AbortError" || /aborted/i.test(err.message),
    );
    assert.equal(abortFired, true);
  });

  it("does not abort fast responses (clearTimeout fires)", async () => {
    const { jwksEntry } = await makeKidA();
    const v = await JwksVerifier.fromUrl("https://fast.example/jwks", {
      timeoutMs: 5_000,
      fetchImpl: fakeFetch(() => jsonResp({ keys: [jwksEntry] })),
    });
    const sig = await (
      await LocalEd25519Signer.fromSeedHex("a".repeat(64), "kid-A")
    ).sign(new TextEncoder().encode("x"));
    assert.equal(await v.verify("kid-A", new TextEncoder().encode("x"), sig), true);
  });
});

// --- F-004 / EVT-004: non-empty cache guard + fire onEmptyJwks --------------

describe("JwksVerifier — non-empty cache guard + onEmptyJwks (F-004 / EVT-004 BB#227)", () => {
  it("preserves cached keys when refresh returns an empty key set", async () => {
    const { signer, jwksEntry } = await makeKidA();
    let onEmptyFired = 0;
    let phase: "good" | "empty" = "good";
    const v = await JwksVerifier.fromUrl("https://flaky.example/jwks", {
      timeoutMs: 5_000,
      ttlMs: 0,
      onEmptyJwks: () => {
        onEmptyFired++;
      },
      fetchImpl: fakeFetch(() => jsonResp(phase === "good" ? { keys: [jwksEntry] } : { keys: [] })),
    });

    const msg = new TextEncoder().encode("preserve me");
    const sig = await signer.sign(msg);
    assert.equal(await v.verify("kid-A", msg, sig), true);

    phase = "empty";
    assert.equal(await v.verify("kid-A", msg, sig), true);
    assert.ok(onEmptyFired >= 1, `expected onEmptyJwks to fire at least once (fired ${onEmptyFired})`);
  });

  it("replaces the cache when refresh returns a non-empty (rotated) key set", async () => {
    const { signer: signerA, jwksEntry: entryA } = await makeKidA();
    const signerB = await LocalEd25519Signer.fromSeedHex("b".repeat(64), "kid-B");
    const binB = String.fromCharCode(...signerB.publicKeyBytes());
    const xB = btoa(binB).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const entryB = { kty: "OKP", crv: "Ed25519", kid: "kid-B", x: xB };

    let serving: "A" | "B" = "A";
    const v = await JwksVerifier.fromUrl("https://rotating.example/jwks", {
      timeoutMs: 5_000,
      ttlMs: 0,
      fetchImpl: fakeFetch(() => jsonResp({ keys: serving === "A" ? [entryA] : [entryB] })),
    });

    const msg = new TextEncoder().encode("rotate me");
    const sigA = await signerA.sign(msg);
    const sigB = await signerB.sign(msg);

    assert.equal(await v.verify("kid-A", msg, sigA), true);
    assert.equal(await v.verify("kid-B", msg, sigB), false);

    serving = "B";
    assert.equal(await v.verify("kid-B", msg, sigB), true);
    assert.equal(await v.verify("kid-A", msg, sigA), false);
  });

  it("EVT-004: throws from fromUrl when initial JWKS load is empty", async () => {
    let onEmptyFired = 0;
    await assert.rejects(
      JwksVerifier.fromUrl("https://misconfigured.example/jwks", {
        timeoutMs: 5_000,
        onEmptyJwks: () => {
          onEmptyFired++;
        },
        fetchImpl: fakeFetch(() => jsonResp({ keys: [] })),
      }),
      /zero OKP\/Ed25519 keys/,
    );
    assert.equal(onEmptyFired, 1, "onEmptyJwks should fire BEFORE the throw");
  });

  it("EVT-004: throws from fromUrl when initial JWKS load has only non-Ed25519 keys", async () => {
    // RSA key in the JWKS — gets filtered out, leaving an empty Ed25519 map
    const rsaEntry = {
      kty: "RSA",
      kid: "rsa-key",
      n: "modulus-base64url",
      e: "AQAB",
    };
    await assert.rejects(
      JwksVerifier.fromUrl("https://wrong-key-type.example/jwks", {
        timeoutMs: 5_000,
        fetchImpl: fakeFetch(() => jsonResp({ keys: [rsaEntry] })),
      }),
      /zero OKP\/Ed25519 keys/,
    );
  });
});

// --- EVT-003: in-flight refresh dedup ---------------------------------------

describe("JwksVerifier — concurrent refresh dedup (EVT-003 BB#227)", () => {
  it("collapses N parallel refresh-triggering verify() calls to ONE fetch", async () => {
    const { signer, jwksEntry } = await makeKidA();
    let fetchCount = 0;

    // Initial load needs one fetch
    const v = await JwksVerifier.fromUrl("https://dedup.example/jwks", {
      timeoutMs: 5_000,
      ttlMs: 0, // every verify triggers a refresh
      fetchImpl: fakeFetch(async () => {
        fetchCount++;
        // small async hop so concurrent calls actually overlap
        await new Promise((r) => setTimeout(r, 5));
        return jsonResp({ keys: [jwksEntry] });
      }),
    });
    assert.equal(fetchCount, 1, "initial fromUrl uses 1 fetch");

    const msg = new TextEncoder().encode("herd");
    const sig = await signer.sign(msg);

    // Burst 10 concurrent verifies — all hit ttl=0 → refresh trigger
    const before = fetchCount;
    const results = await Promise.all(
      Array.from({ length: 10 }, () => v.verify("kid-A", msg, sig)),
    );
    const refreshesTriggered = fetchCount - before;

    assert.deepEqual(results, Array(10).fill(true), "all verifies succeed");
    assert.equal(
      refreshesTriggered,
      1,
      `expected exactly 1 in-flight refresh across 10 concurrent verifies, got ${refreshesTriggered}`,
    );
  });
});
