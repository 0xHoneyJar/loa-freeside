# Upload checklist

Manual GitHub upload of `freeside-design-system-v1-rc.zip` into
`0xHoneyJar/loa-freeside` at `packages/freeside-design-system/`.

Work top to bottom. **Step 10 is the only step that writes to the remote.**

---

## 1 · Unzip

```bash
mkdir -p /tmp/fds
unzip ~/Downloads/freeside-design-system-v1-rc.zip -d /tmp/fds
```

Extract somewhere neutral — **not** inside the repository clone.

## 2 · Confirm the expected root folder

```bash
ls /tmp/fds
```

Expect exactly one entry: `freeside-design-system`. If you see loose files, the archive was
extracted a level too deep — start again.

```bash
cd /tmp/fds/freeside-design-system
ls
```

Expect: `README.md CLAUDE.md CHANGELOG.md MANIFEST.md KNOWN-GAPS.md REPO-INTEGRATION.md
MIGRATION-FROM-FIRST-ATTEMPT.md UPLOAD-CHECKLIST.md package.json styles.css environment.css
tokens/ components/ templates/ cards/ retrofit/ docs/ examples/ assets/ dist/ scripts/`

## 3 · Verify before it touches the repo

```bash
node --version                       # expect v22 or later
node scripts/verify.js               # expect: OK — tree is portable
```

`verify.js` checks every local `src`/`href`/`url()`/`@import` reference resolves case-correctly,
that no absolute path, blob URL, `about:blank` marker or Claude host survives, that each template
carries its own copy pack and `ds-base.js`, and that no style holes remain.

## 4 · Install dependencies

```bash
npm install
```

**There are none.** The package has an empty dependency graph and therefore no lockfile — see
MANIFEST.md. `npm install` succeeds and creates nothing; `npm ci` will fail for want of a
lockfile, which is expected and not a defect. Node 22+ is needed only for the runner and the
static server.

## 5 · Run the tests

```bash
npm test
```

Expect, exactly:

```
37 checks · 276 cases · 6 packs
VERDICT PASS · 0 failures · 0 suppressions · 0 advisories
```

Exits non-zero on any failure **or any guard suppression**. A suppression means a projection was
dropped rather than rendered — treat it as a failure, because it is one.

## 6 · Run the documentation site

```bash
npm run dev
```

Open <http://localhost:4173/dist/index.html>. Check by eye:

- The counts strip matches step 9.
- Every template link opens and **renders with real data** — not an empty template with blank
  holes. If a page is blank, it was opened as `file://` rather than through the server.
- `cards/brand-environment.card.html` shows the plate at four precisions.
- `cards/doctrine-conformance.card.html` shows the same verdict as step 5.

`Ctrl-C` when done.

## 7 · Run the production build

```bash
npm run build
```

Regenerates `dist/index.html` and `dist/manifest.json` by reading the tree. Then:

```bash
npm run preview     # serves dist/ on http://localhost:4174
```

## 8 · Compare counts against the release baseline

```bash
node -e "const m=require('./dist/manifest.json');console.table(m.counts)"
```

| Count | Baseline |
|---|---|
| tokens | 260 |
| components | 15 |
| templates | 6 |
| copyPacks | 5 |
| fragments | 163 |
| cards | 26 |
| assets | 3 |

`copyPacks` is 5 here and 6 in the test output: the suite registers a sixth pack from
`templates/_doctrine/fixtures.js` that has no template folder of its own. `templates/station-console/`
is the template with no copy pack — it is not doctrine-projected.

A **lower** number than the baseline means files did not extract. Stop and re-extract.

## 9 · Move it into the repository

```bash
cd /path/to/your/loa-freeside
git checkout main && git pull
git checkout -b feat/freeside-design-system-v1-rc

# destination must be empty
ls packages/freeside-design-system 2>/dev/null && echo "STOP: path exists" || echo "clear"

cp -R /tmp/fds/freeside-design-system packages/freeside-design-system

# the diff must be purely additive
git status --porcelain | grep -v '^?? packages/freeside-design-system/' || echo "additive only"
```

If that `grep` prints anything, **stop**. Something outside the new directory changed.

Then re-run in place:

```bash
(cd packages/freeside-design-system && npm test && npm run verify)
```

Confirm the root `CLAUDE.md` is untouched — the package ships its own:

```bash
git diff --stat main -- CLAUDE.md    # expect: no output
```

## 10 · Commit — only after every check above passes

```bash
git add packages/freeside-design-system
git commit -m "feat(design-system): Freeside Design System v1.0.0-rc.1

Exposure doctrine, tokens, 15 components, 6 templates, 26 cards,
conformance suite (37 checks / 276 cases / 6 packs, green, 0 suppressions).

Source of truth. apps/freeside-operator-dash and themes/sietch/dashboard
remain consumers; neither is modified by this commit."

git push -u origin feat/freeside-design-system-v1-rc
```

## 11 · Verify what GitHub actually received

```bash
git clone git@github.com:0xHoneyJar/loa-freeside.git /tmp/verify-fds
cd /tmp/verify-fds && git checkout feat/freeside-design-system-v1-rc
cd packages/freeside-design-system && node scripts/verify.js && node templates/_doctrine/run-checks.js
```

A fresh clone proves nothing depended on your local state. Then confirm on github.com:

- `assets/terrace-plate.png` and `assets/station-interior.png` render as images, not LFS pointers.
- `dist/full-system.html` is ~3 MB, not truncated.
- Card and asset filenames are lowercase-with-hyphens (macOS hides case errors; Linux does not).

---

## Do not

- **Do not run `pnpm install` at the repository root** as part of this upload. The root
  `postinstall` runs `scripts/rebuild-hounfour-dist.sh`, which is unrelated and will muddy the diff.
- **Do not let the package's `CLAUDE.md` overwrite the root one.**
- **Do not edit `packages/README.md`, `.github/CODEOWNERS`, CI config or any consumer** in this
  commit. Those are listed as deliberate later edits in REPO-INTEGRATION.md.
- **Do not merge into `packages/ui/`.** It exists with a different remit.
