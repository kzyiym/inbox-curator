# Changelog

## 1.0.4

- Fix ESLint and TypeScript compilation warnings (unsafe any assignments/accesses, unnecessary assertions).
- Fix `globalThis` warning by replacing it with `window.require` type-safe helper for popout window compatibility.
- Clean up unused regex escapes.

## 1.0.3

- Replace `localStorage.getItem("language")` with Obsidian `getLanguage()` API.
- Add GitHub artifact attestations to release workflow for supply-chain transparency.
- Replace deprecated `setWarning()` with `setDestructive()` in settings.
- Fix Promise-returned-where-void-expected in `onClick` handlers; add missing error handling.
- Add missing i18n keys for API key deletion and log clear failures.

## 1.0.2

- Add `match-obsidian` prompt language option (follow Obsidian UI language).
- Fix Obsidian API compatibility and code quality issues (`setHeading`, manifest fields).
- Update min App version to `1.11.4`.

## 1.0.1

- Collection review: cross-note analysis for selected notes and folders.
- Auto-sort undo: `Undo last auto-sort run` command.
- Content filtering: context budget management with priority-based trimming.
- Operation logging: structured JSONL logs with daily rotation.
- Error logging: rotating error logs in `.inbox-curator/logs/`.
- i18n: full English and Japanese UI.
- Image optimization: in-memory resize/compress for images up to 10 MB.
- Prompt injection detection: automatic scanning with configurable blocking.
- Provider error classifier: structured error messages for API issues.
- Comprehensive test suite (31 test files).

## 1.0.0

- Initial public release.
- AI note review with OpenAI, Gemini, and Anthropic providers.
- Batch processing with configurable concurrency and rate limiting.
- URL detection and article text extraction.
- Attachment awareness (images, PDF, audio, video).
- Image review with multimodal models (up to 3 images, 1 MB each).
- Experimental PDF text extraction (first 5 pages, up to 10,000 chars).
- Auto-sort actions (Archive, Read Later, Task, Delete Candidate).
- Automatic file watching with polling fallback.
- Deduplication via `ai_review_source_hash` frontmatter.
- Secure API key storage via SecretStorage.
- Custom review prompt support.
- Context budget presets (small / standard / large / custom).
- OpenAI-compatible token limit auto-detection.
- Desktop-only (Obsidian v1.11.4+).
