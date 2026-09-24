# Changelog

## Unreleased

- Review queue monitor (`Open review queue monitor`): view pending, running, and failed reviews in one panel. Pause/resume the queue (in-flight API requests are not interrupted), cancel individual pending jobs, and retry failed notes.
- Retry preserves the original job source, so a watched-folder job keeps its normal auto-sort behavior (existing confidence, allowlist, and prompt-injection checks still apply). Retrying skips the API call when the note no longer exists or is already reviewed (`ai_review_source_hash` matches).
- Failed rows show only a classified reason (rate limit, timeout, invalid response, etc.); raw error text, note content, and provider responses are never shown in the UI and remain in the logs.
- The failed list reflects the current processing state: it is cleared when a note is re-queued and is not restored if that retry is cancelled.

## 1.2.0

- Reading decision: each review now starts with `Read the source` / `Summary is enough` / `Reference when needed` / `Hold`, plus a one-sentence, article-specific reason. It is independent from the filing action and does not change auto-sort behavior.
- Streamlined review output: merged overlapping sections into Key Points (max 3) and Takeaways (max 2, omitted when empty). Removed the duplicate Overview / Why It Matters / Suggested Use sections.
- Prompt and schema cleanup: the AI is no longer asked to generate `detailedSummary`, `practicalityReview`, `retentionReasons`, `strengths`, `risksOrGaps`, `nextActions`, or `decisionReason`. Legacy responses and existing reviews still render via fallbacks; old reviews show the reading decision as `Not assessed`.
- Personal experience and opinion content are no longer treated as low value solely for being subjective. Author claims are described as claims, not verified facts, and unsupported usefulness/novelty is not invented.
- Caveats are now content-based. Removed the generic "recheck the official source" boilerplate that was previously added based only on source type (`personal_blog` / `news_article`).
- Input insufficiency: notes with no readable body, or URL-only notes whose fetch failed, are skipped before the API call (no auto-sort, no API cost). Short but valid notes are still reviewed.
- Custom review prompt can now carry interests or current tasks, used mainly for the reading decision.
- Persist `ai_review_reading_decision` to source note frontmatter.
- Opt-in single-note diagnostic capture (`Review current note (diagnostic capture)`): records the exact system/user prompt, raw AI response, and normalized result to a local git-ignored file (`.inbox-curator/diagnostics/`). It does not write or overwrite a review note, does not update the source note, and does not run auto-sort. Secrets are masked.

## 1.1.0

- Action allowlist: per-action toggles (Archive, Read Later, Task, Delete Candidate) that gate auto-execution and panel apply without changing review output.
- Configurable confidence thresholds: set a minimum confidence per auto-sort action (defaults preserve prior behavior — Medium for Archive/Read Later, High for Task). Reliability checks still apply on top.
- Action review panel: a unified dry-run preview / approval / execute-selected modal listing watched-folder notes with their proposed action, confidence, reliability, auto-execute verdict, and resolved destination. New commands `Open action review panel` and `Dry-run auto-sort (preview)`.
- Persist `ai_review_confidence` and `ai_review_reliability_label` to note frontmatter so the panel can recompute decisions for already-reviewed notes.
- **Security:** Stop all auto-execution actions when prompt injection is detected. Image inputs, fetched external articles, and extracted PDF contents are also scanned or fail-closed.
- **Security:** Enhanced concurrency safety by detecting and aborting if a note is modified during review, using hash comparison and atomic updates.
- **Security:** Prevent SSRF attacks by prohibiting background polling/watch jobs from fetching remote URLs.
- **Security:** Universal log masking to redact API keys, tokens, and Base64 payloads.
- **Security:** Strengthened folder path validation for AI-suggested destinations.

## 1.0.4

- Fix ESLint and TypeScript compilation warnings (unsafe any assignments/accesses, unnecessary assertions).
- Fix `globalThis` warning by replacing it with `window.require` type-safe helper for popout window compatibility.
- Clean up unused regex escapes.

## 1.0.3

- Replace `localStorage.getItem("language")` with Obsidian `getLanguage()` API.
- Add GitHub artifact attestations to release workflow for supply-chain transparency.
- Fix Promise-returned-where-void-expected in `onClick` handlers; add missing error handling.
- Add missing i18n keys for API key deletion and log clear failures.
- Keep `setWarning()` for the API-key delete button: `setDestructive()` requires a newer min App version than `1.11.4`, so the earlier switch was reverted.

## 1.0.2

- Update min App version to `1.11.4` (required for the SecretStorage / trashFile APIs).
- Remove unknown `icon` field from `manifest.json`.
- Replace raw `h4`/`h5` heading elements with `Setting#setHeading()` in the settings UI.

## 1.0.1

- Add `match-obsidian` prompt language option (follow Obsidian UI language) and improve note-language detection.
- Resolve Obsidian API compatibility and code-quality issues: use `FileManager.trashFile()` for delete candidates so Obsidian's deletion preference is respected, improve popout-window compatibility, tighten typing around provider requests / PDF extraction / Base64 masking, and clarify fire-and-forget logging with an explicit `void`.
- Add repository social preview image.

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
- Desktop-only (Obsidian v1.5.0+ at release; raised to v1.11.4 in 1.0.2).
