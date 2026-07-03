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
f351f0280a651ee2833a96c1ddddfbe78771909331f9bcdfa913665dfffc7013  SKILL.md
c03c4394ad9c18f5b41454c0314ea749b8d8a36c74da2dcbefff2886d3270783  handoff.md
6e00fae9d30866d728ee3f52aa7f934e9eeaec7b2fa64db33d901d04a58b5424  manifest.json
ea7e535da107af507ce3a8919bacef95e33c6dcf941e4e35a07c0e94ea0bafbf  reality.md
22ca9f732c2a75e5eddb78a0b3a5c6a90999dc0f23387971210fdef930a7fa00  skills/diagnose/SKILL.md
f351f0280a651ee2833a96c1ddddfbe78771909331f9bcdfa913665dfffc7013  skills/observe/SKILL.md
152face2f7dbe12306fd776c65fd0d720b8fa0f04d74b1f1f96ed181d0446081  skills/patrol/SKILL.md
772c43e9e92d5c8275359e6bffecc804e9fafcadce3dafae73e3662a3697d99f  skills/report/SKILL.md
6675aedbbaa2f690872f5370fc97e535364516af3697e23519939fc692d9c0ca  skills/sense-estate/SKILL.md
2982407e7bb980f3f8559b9c462e019cc893423fb095c485994a5eee4b2d3cf3  skills/sensing-config-drift/SKILL.md
d7808d7ae90f13d3094a14348f7bdbfcee4601df680d5c79e596a80a8db7c4d7  skills/sensing-construct-console/SKILL.md
4ca11122ab958d38468dfb3ff5ee52527ac77227780691eac9ee04d40f69e6f5  skills/sensing-deployment-seam/SKILL.md
14cf050b8f095d3fe80eac9ec614b46772ae8dec29c4f0482753ca5941623375  skills/sensing-path-friction/SKILL.md
d15d8d873f1cd1f6e683e5197a4ed1f5507f8a62863f13865198506915fde247  skills/sensing-runtime-fit/SKILL.md
327ed902cf4f259edd7d964a8117a40f37c098199ebf012c39bb9cbfbe92bf89  skills/sweep-bonfire/SKILL.md
```

content_hash = `b7d7ca427ef3bf56bc665bed80f9921dc0cdd059ddc5ed1dfa2fbce80b2e3831`
