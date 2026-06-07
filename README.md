# Inbox Curator

Use Inbox Curator when your Obsidian inbox contains saved articles, AI chat logs, rough notes, or URL-only captures, and you want help deciding what is worth keeping, summarizing, organizing, or reviewing later.

Plugin ID: `kzyiym-inbox-curator`
Display name: `Inbox Curator`
Repository: https://github.com/kzyiym/inbox-curator

## Current status

This plugin is no longer just a scaffold.

Current implementation focuses on:
- reviewing the current Markdown note with an OpenAI-compatible API
- manually processing a single watched folder in batch
- optionally auto-watching a single watched folder for create/modify events
- optionally polling the watched folder for missed changes
- writing a separate AI review note
- storing minimal review state back into the source note frontmatter
- skipping unchanged notes with a source hash
- detecting URL-only notes and fetching URL context
- extracting readable text from some static HTML article pages
- provider abstraction for AI chat transport
- attachment-aware prompting with conservative media handling

Automatic watching and polling are now available, but both are default OFF. The plugin still does not implement persistent queue workers, JavaScript page rendering, PDF extraction, actual image analysis, or actual video analysis.

## What works now

### Commands

The plugin currently registers these commands:
- `Review current note`
- `Process watched folder`

`Review current note`
- reviews the active Markdown note
- shows a short Notice and status bar message while running
- prevents duplicate execution while another review is in progress

`Process watched folder`
- scans one watched folder
- processes Markdown files serially
- excludes review notes in the review output folder
- excludes `*.ai-review.md`
- skips notes whose `ai_review_source_hash` still matches the current source hash
- limits AI-reviewed candidates with `Max notes per run`
- keeps skipped notes outside that cap
- reports `processed / skipped / failed / remaining` when done
- spaces AI requests using `Requests per minute` and `Delay between requests`
- retries transient AI request failures with backoff before giving up

Important: manual watched-folder processing still exists and remains the most explicit way to run a bounded batch.

### Automatic watching and polling

Automatic watched-folder behavior is now available, but everything is conservative by default:
- `Automatic watching` is default OFF
- `Auto-review on create` is default OFF
- `Auto-review on modify` is default OFF
- `Polling fallback` is default OFF

When enabled, the plugin:
- watches the configured watched folder for Markdown note create/modify events
- ignores files in the review output folder
- ignores `*.ai-review.md`
- debounces noisy modify bursts with `Watch debounce`
- re-checks the source hash before enqueueing an automatic review
- uses polling as a fallback rescan mechanism when enabled
- keeps automatic jobs on the same serial queue and shared rate limit as manual jobs

Polling is intended as a fallback, not as a replacement for explicit manual batch runs.

### Review output

Each review writes a separate note to the configured review output folder.

The review note currently includes:
- `Decision`
- `Why this decision`
- `Quick Summary`
- `Structured Summary`
- `Attachments`
- `Retention Value`
- `Evidence Basis`
- `Risks / Gaps`
- `Verification Needed`
- `Next Actions`
- `Action Items`
- `Organization`

`Quick Summary`
- stays short
- uses at most 3 items

`Structured Summary`
- is meant for reuse, not a long narrative recap
- can include:
  - central claim
  - key points
  - comparison table when the article actually has a comparison structure
  - evidence mentioned in the note

### Source note frontmatter

After a successful review, the source note is updated with minimal `ai_review_*` frontmatter such as:
- review status
- processed timestamp
- source hash
- output path
- content type
- input profile
- scores
- priority
- recommended action
- verification flags
- attachment counts when attachments were detected
- source URL when available

The plugin ignores its own `ai_review_*` frontmatter when calculating the source hash, so it does not force pointless re-review loops.

## Current settings

The plugin currently stores these values in normal plugin settings (`data.json`):
- Watched folder
- Review output folder
- Max notes per run
- Requests per minute
- Delay between requests
- Automatic watching
- Auto-review on create
- Auto-review on modify
- Watch debounce
- Polling fallback
- Polling interval
- Fetch URL metadata
- Extract URL article text
- Max extracted characters
- Read images
- Read videos
- Provider
- Endpoint URL
- Model

The API key is stored separately in Obsidian SecretStorage and is not written to `data.json`.
Saved API keys are masked in the settings UI.

### Settings behavior

- `Watched folder`
  - single watched folder for the current MVP
- `Review output folder`
  - separate AI review notes are written here
- `Max notes per run`
  - caps only AI-reviewed candidates in watched-folder runs
  - skipped notes do not count toward the cap
- `Requests per minute`
  - sets a minimum delay between queued AI review attempts
- `Delay between requests`
  - adds an explicit delay in milliseconds between queued AI review attempts
  - the larger of this and the RPM-derived delay is used
- `Automatic watching`
  - default OFF
  - enables watched-folder create/modify event handling
- `Auto-review on create`
  - controls whether new Markdown notes in the watched folder are auto-enqueued
- `Auto-review on modify`
  - controls whether changed Markdown notes in the watched folder are auto-enqueued
- `Watch debounce`
  - collapses noisy create/modify bursts before an automatic review is enqueued
- `Polling fallback`
  - default OFF
  - periodically rescans the watched folder for changed notes that may have been missed by file events
- `Polling interval`
  - polling interval in milliseconds when polling fallback is enabled
- `Fetch URL metadata`
  - enables metadata fetch for URL-only notes
  - can be used with or without article text extraction
- `Extract URL article text`
  - tries to fetch static HTML and extract readable article text for URL-only notes
  - JavaScript rendering and PDF extraction are still not supported
- `Max extracted characters`
  - caps the extracted article text included in the AI review prompt
- `Read images`
  - currently affects prompting only
  - the plugin may tell the AI that image attachments exist
  - image bytes are not actually sent or analyzed yet
- `Read videos`
  - currently affects prompting only
  - the plugin may tell the AI that video attachments exist
  - video bytes or transcripts are not actually sent or analyzed yet
- `Provider`
  - provider abstraction exists
  - only `openai-compatible` is implemented right now
- `Endpoint URL`
  - stored in `data.json`
- `Model`
  - entered manually for now

### Current defaults

- Provider: `openai-compatible`
- Default endpoint URL: `https://api.openai.com/v1`
- Default model: `gpt-4o-mini`
- Default watched folder: `Inbox`
- Default review output folder: `AI Reviews`
- Default max notes per run: `10`
- Default requests per minute: `10`
- Default delay between requests: `1000` ms
- Default automatic watching: `false`
- Default auto-review on create: `false`
- Default auto-review on modify: `false`
- Default watch debounce: `1500` ms
- Default polling fallback: `false`
- Default polling interval: `30000` ms
- Default fetch URL metadata: `true`
- Default extract URL article text: `true`
- Default max extracted characters: `12000`
- Default read images: `false`
- Default read videos: `false`

## Attachment-aware prompting

The current implementation can inspect note links and embeds to build a conservative attachment inventory.

It currently:
- detects linked or embedded non-Markdown attachments from wikilinks and markdown links
- classifies likely attachment kinds such as image, video, audio, PDF, document, archive, or other
- records attachment counts in the review result and source-note frontmatter
- passes attachment inventory into the AI prompt
- explicitly tells the AI not to pretend image/video/audio/PDF contents were actually read unless the note text itself provides that content

This is intentionally not real attachment analysis.
The plugin does not currently upload image bytes, render video, fetch transcripts, OCR PDFs, or inspect attachment contents directly.

## URL-only note handling

The current implementation detects URL-only notes from the note body after frontmatter is removed.

A note is treated as URL-only when the body is effectively:
- one URL
- or URL plus whitespace
- or URL plus very small heading-only structure

For URL-only notes:
- `contentType` stays `url_only` when only the URL shell or metadata are available
- `contentType` becomes `fetched_url` when static HTML was fetched and usable article text was extracted
- `inputProfile` stays `url_only` for metadata-only review
- `inputProfile` becomes `web_article` when extracted article text is available
- the first detected URL is used
- the plugin can fetch metadata and, when enabled, try static article text extraction
- JavaScript-rendered pages and PDFs are still not handled

When metadata fetch is enabled, the plugin may collect:
- `<title>`
- `meta[name="description"]`
- `meta[property="og:title"]`
- `meta[property="og:description"]`
- `meta[property="og:site_name"]`
- `meta[property="og:type"]`
- `meta[property="og:url"]`
- `meta[name="twitter:title"]`
- `meta[name="twitter:description"]`
- `link[rel="canonical"]`

Metadata fetch failure does not stop the review. The review continues with limited context.

When URL article extraction is enabled, the plugin also tries to:
- fetch static HTML
- remove obvious non-content elements
- pick a high-text content container
- send a capped excerpt of extracted article text to the AI review prompt

This is intentionally basic extraction. It does not execute page JavaScript, open a browser, or parse PDFs.

## Safety and logging

The plugin is intentionally conservative about logs and UI output.

It does not intentionally print:
- API keys
- Authorization headers
- tokenized remote URLs
- full note bodies
- full AI responses

Failure logs are kept short and typically include only:
- provider
- endpoint URL
- model
- note path
- HTTP status when available
- short error text
- short response snippet when useful

## Not implemented yet

The following are intentionally not implemented yet:
- persistent queue workers
- parallel processing
- robust Readability-quality extraction
- JavaScript page rendering
- screenshot-based browsing
- PDF extraction
- actual image analysis
- actual video analysis
- attachment content analysis
- automatic file moves
- automatic deletion
- model list fetch
- provider-specific implementations beyond `openai-compatible`

## Development

Install dependencies:

```bash
pnpm install
```

Type-check:

```bash
pnpm check
```

Build:

```bash
pnpm build
```

Run tests:

```bash
pnpm test
```

Watch mode:

```bash
pnpm dev
```