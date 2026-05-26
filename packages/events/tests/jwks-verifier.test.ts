import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { JwksVerifier, LocalEd25519Signer } from "../src/signer.js";

// --- helpers ----------------------------------------------------------------

async function makeKidA() {
  const signer = await LocalEd25519Signer.fromSeedHex("a".repeat(64), "kid-A");
  // base64url-encoded raw 32-byte ed25519 pubkey (the same shape JWKS x emits)
  const bin = String.fromCharCode(...signer.publicKeyBytes());
  const x = btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return { signer, jwksEntry: { kty: "OKP", crv: "Ed25519", kid: "kid-A", x } };
}

function fakeFetch(
  responder: (url: string, init?: RequestInit) => Promise<Response> | Response,
): typeof fetch {
  return ((url: string, init?: RequestInit) => Promise.resolve(responder(url, init))) as unknown as typeof fetch;
}

function jsonResp(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
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
        // intentionally never resolves
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
    // verify it loaded the key
    const sig = await (await LocalEd25519Signer.fromSeedHex("a".repeat(64), "kid-A")).sign(
      new TextEncoder().encode("x"),
    );
    assert.equal(await v.verify("kid-A", new TextEncoder().encode("x"), sig), true);
  });
});

// --- F-004: non-empty cache guard ------------------------------------------

describe("JwksVerifier — non-empty cache guard (F-004 BB#227)", () => {
  it("preserves cached keys when refresh returns an empty key set", async () => {
    const { signer, jwksEntry } = await makeKidA();
    let onEmptyFired = 0;
    let phase: "good" | "empty" = "good";
    const v = await JwksVerifier.fromUrl("https://flaky.example/jwks", {
      timeoutMs: 5_000,
      ttlMs: 0, // force refresh on every verify() so we can drive the empty branch
      onEmptyJwks: () => {
        onEmptyFired++;
      },
      fetchImpl: fakeFetch(() => jsonResp(phase === "good" ? { keys: [jwksEntry] } : { keys: [] })),
    });

    const msg = new TextEncoder().encode("preserve me");
    const sig = await signer.sign(msg);

    // baseline: verify works against the loaded key
    assert.equal(await v.verify("kid-A", msg, sig), true);

    // now flip the endpoint to return an empty key set; verify must still succeed
    // (cache preserved) and onEmptyJwks must fire
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

    // baseline: A works, B does not
    assert.equal(await v.verify("kid-A", msg, sigA), true);
    assert.equal(await v.verify("kid-B", msg, sigB), false);

    // rotate: now JWKS serves B only
    serving = "B";

    // B works (rotation took effect); A should fail (cache replaced)
    assert.equal(await v.verify("kid-B", msg, sigB), true);
    assert.equal(await v.verify("kid-A", msg, sigA), false);
  });
});
