# Post-P6 Stabilization Report

## Summary
- Overall status: Stabilization pass completed with a minimal automated test foundation added.
- Release readiness: Better than before, but still not something I would call fully release-ready without real Obsidian runtime validation and real provider/API validation.
- Biggest remaining risk: Runtime behavior inside real Obsidian still depends on file events, SecretStorage, Notice/status UX, and external provider/network behavior that this pass did not exercise directly.

## Verified by command
- `pnpm check`: pass
- `pnpm build`: pass
- `pnpm test`: pass
- `pnpm lint`: not available

## Tests added
- frontmatter:
  - preserves non-`ai_review_*` frontmatter
  - writes attachment count fields when attachment summary exists
  - removes stale attachment count fields when absent
  - writes `ai_review_source_url` when present
  - removes stale `ai_review_source_url` when absent
- attachmentContext:
  - parses Obsidian wikilinks
  - parses Markdown links and embeds
  - handles unresolved attachment paths safely
  - classifies image / video / audio / pdf / document / archive kinds
  - avoids overcounting repeated references to the same attachment path
- reviewPipeline URL logic:
  - treats URL-only body plus heading-only structure as `url_only`
  - does not classify meaningful body text as `url_only`
  - promotes to `fetched_url` / `web_article` only when extracted article text exists
  - keeps metadata-only results as `url_only`
- urlExtraction:
  - parses `<title>`, description meta, Open Graph fields, and canonical URL
  - returns metadata safely when extraction quality is insufficient
  - caps extracted text to the configured maximum
  - tolerates malformed HTML without throwing

## Verified by code inspection
- queue:
  - manual watched-folder processing remains serial
  - duplicate execution suppression exists for review execution paths already inspected earlier in this stabilization pass
- retry / rate limit:
  - retry and rate-limit components remain wired into watched-folder processing
- automatic watching:
  - automatic watching default remains OFF
  - auto-review on create/modify defaults remain OFF
- polling:
  - polling fallback default remains OFF
- watched-folder filtering:
  - review output folder exclusion exists
  - `*.ai-review.md` exclusion exists
- URL extraction fallback:
  - metadata fetch and static article extraction remain separated
  - `fetched_url` promotion only occurs when usable extracted text exists
- provider abstraction:
  - provider boundary still routes through the current `openai-compatible` implementation
- attachment-aware prompting:
  - attachment inventory remains conservative and prompt-only for images/videos
- logging safety:
  - code inspected in this pass still avoids obvious full-secret / full-note-body logging
- README accuracy:
  - wording remains aligned with implemented behavior, including conservative attachment-aware wording

## Not yet verified
- Obsidian runtime behavior: not independently re-run in this pass
- real vault event behavior: not verified by automated tests
- real provider API behavior: not verified
- real URL fetch behavior against external sites: not verified
- SecretStorage behavior in real Obsidian: not verified
- Notice/status bar UX: not verified
- manual validation matrix: only partially covered outside this automated pass; user reported step 1 OK, but it was not independently re-executed here

## Fixed issues
- stale `ai_review_attachment_count` and `ai_review_unresolved_attachment_count` can now be removed when attachment data is absent in a later review
- stale `ai_review_source_url` can now be removed when no source URL is present
- settings wording for `Read images` / `Read videos` was aligned with actual prompting-only behavior
- attachment inventory no longer overcounts the same attachment path when referenced multiple times in different link/embed forms
- `pnpm test` is no longer dead; the repository now has a working minimal Vitest suite

## Known limitations
- persistent queue: not implemented
- true multimodal: not implemented
- multiple providers: not implemented beyond `openai-compatible`
- PDF/OCR: not implemented
- JS-rendered pages: not implemented
- automatic move/delete: not implemented

## Recommended next actions
1. Run a real Obsidian manual validation pass on file events, polling fallback, unload/reload cleanup, and review-note writeback behavior.
2. Add one small integration-style test seam around watched-folder filtering or source-hash skip logic if that area changes again.
3. Decide whether the next phase is persistent queueing, broader provider support, or true attachment transport. I would not start with multimodal marketing claims before runtime validation is solid.
