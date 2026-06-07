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
- writing a separate AI review note
- storing minimal review state back into the source note frontmatter
- skipping unchanged notes with a source hash
- detecting URL-only notes and fetching metadata only

It does not yet implement automatic background watching, queue workers, full article extraction, image analysis, or video analysis.

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

Important: watched-folder processing is manual only right now. There is no automatic file watcher yet.

### Review output

Each review writes a separate note to the configured review output folder.

The review note currently includes:
- `Decision`
- `Why this decision`
- `Quick Summary`
- `Structured Summary`
- `Retention Value`
- `Evidence Basis`
- `Risks / Gaps`
- `Verification Needed`
- `Next Actions`
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
- source URL when available

The plugin ignores its own `ai_review_*` frontmatter when calculating the source hash, so it does not force pointless re-review loops.

## Current settings

The plugin currently stores these values in normal plugin settings (`data.json`):
- Watched folder
- Review output folder
- Max notes per run
- Requests per minute
- Delay between requests
- Fetch URL metadata
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
- `Fetch URL metadata`
  - enables metadata fetch for URL-only notes
  - full article extraction is not implemented yet
- `Read images`
  - saved for future use only
  - image analysis is not implemented yet
- `Read videos`
  - saved for future use only
  - video analysis is not implemented yet
- `Provider`
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
- Default fetch URL metadata: `true`
- Default read images: `false`
- Default read videos: `false`

## URL-only note handling

The current implementation detects URL-only notes from the note body after frontmatter is removed.

A note is treated as URL-only when the body is effectively:
- one URL
- or URL plus whitespace
- or URL plus very small heading-only structure

For URL-only notes:
- `contentType` becomes `url_only`
- `inputProfile` becomes `url_only`
- the first detected URL is used
- the plugin can fetch metadata only
- it does not fetch or extract the full article body yet

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
- automatic watched-folder monitoring
- polling
- queue workers
- parallel processing
- full HTML article extraction
- Readability-style extraction
- JavaScript page rendering
- screenshot-based browsing
- PDF extraction
- image analysis
- video analysis
- attachment analysis
- automatic file moves
- automatic deletion
- model list fetch
- provider-specific branching beyond `openai-compatible`

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

Watch mode:

```bash
pnpm dev
```