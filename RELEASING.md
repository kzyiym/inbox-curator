# Releasing Inbox Curator

This document is the source of truth for cutting a release. Agent-facing notes may also live in `AGENTS.md`, but that file is not tracked — keep shared release steps here.

## 1. Prepare the version bump

Update all of these in the same change:

- `manifest.json` → `version` (and `minAppVersion` if it changed)
- `package.json` → `version`
- `versions.json` → add a new `"<version>": "<minAppVersion>"` entry (keep existing entries)
- `README.md` → the `Version` line and any version references in the text
- `CHANGELOG.md` → add a new section for the version at the top

## 2. Write the release notes

Create `release-notes/<version>.md` (bilingual: English first, then a `---` separator and the Japanese section).

- File name uses the version **without** a `v` prefix (tag `1.2.0` or `v1.2.0` → `release-notes/1.2.0.md`).
- Keep the shape consistent:
  - `## Inbox Curator v<version>` and a one-line summary
  - `### ✨ Highlights`
  - optional `### 🔒 Security` / `### 🐛 Fixes`
  - `### 📝 Notes`
  - `---` then `### 🇯🇵 Inbox Curator v<version>（日本語）` and the same structure in Japanese
  - a footer with the full changelog link and install instructions
- **Commit the notes before creating the tag.** The release workflow checks out the tagged commit, so the file must already be in that commit.

If no `release-notes/<version>.md` exists, the workflow falls back to GitHub's auto-generated notes.

## 3. Verify

```bash
pnpm check
pnpm build
pnpm test
```

## 4. Tag and push

```bash
git tag <version>
git push origin <version>
```

Tags matching `*.*.*` trigger `.github/workflows/release.yml`, which type-checks, tests, builds the plugin, attests the artifacts, and creates the GitHub Release with `main.js`, `manifest.json`, and `styles.css` attached. When `release-notes/<version>.md` is present, its contents are used as the release body.

## 5. Confirm

```bash
gh release view <version> --json body
```

## Notes

- Do not create tags or releases without human approval.
- Never commit secrets or local-only files.
- Editing an existing release body is safe and idempotent:
  `gh release edit <version> --notes-file release-notes/<version>.md`
