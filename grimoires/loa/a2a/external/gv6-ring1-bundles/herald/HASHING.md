# content_hash recipe (== construct-rubric.py C9)

`bundle_schema_version` 1.0.0 · rubric: `sha256:c181978e4e8f2bce65171f57eb0fe6da4f1c0a52ec46118c1443ef92d52af9df`

```
core = [manifest.json, reality.md, handoff.md] + SKILL.md (root, if present)
       + skills/**/SKILL.md, sorted by bundle-relative path
listing = concat(f'{sha256(bytes)}  {relpath}\n')
content_hash = sha256(listing)
```

Sidecars excluded: genome.jsonl, proof-of-run.json, registration.json, HASHING.md, EXPECTED.md, INJECTIONS.md.

## Per-member digests

```
a915a9cbeb167b65660443acf0c2876ac6382c9abb28bc2b3e62de8378c4b2a3  SKILL.md
82e8b2fb7baf99f49c5c2ea8210d26b571e69ac1b88d3071eaa54f7beabe4c8b  handoff.md
0d1ccdbbb5d3c1bb4d977dd7aae79d9690aba2bbc2208334d21158b92254e402  manifest.json
e1055a50be04a6dfb455df8bcda3249ee2e02300935fb274067fd066c6465263  reality.md
bc4d8c1e07c4af5cb9089fdd57018890c17c780fc4977fb378a15731acfdfcc3  skills/chronicling-changes/SKILL.md
a915a9cbeb167b65660443acf0c2876ac6382c9abb28bc2b3e62de8378c4b2a3  skills/grounding-announcements/SKILL.md
cfcbc7e3d70b93937bc995b91402efa5cdd669295165ed0876871835324b75f8  skills/synthesizing-voice/SKILL.md
```

content_hash = `80f611e491d62d6ad2389b9394e8d57c22adc97cc926f9fc9572578e5065f1ce`
