# Inbox Curator

Inbox Curator is an Obsidian community plugin for reviewing and triaging notes in your inbox.

Current status: initial scaffold.

Plugin ID: `kzyiym-inbox-curator`
Display name: `Inbox Curator`
Repository: https://github.com/kzyiym/inbox-curator

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

Current AI-related settings are preparation only:

- Provider: `openai-compatible`
- Default endpoint URL: `https://api.openai.com/v1`
- Default model: `gpt-4o-mini`
- Review commands show a short status bar message while AI review is running
- Review current note prevents duplicate execution while a review is already in progress
- Watched-folder runs are capped by Max notes per run and spaced by Requests per minute / Delay between requests
- URL-only notes are detected and can fetch title/description/Open Graph metadata only
- Full article extraction is not implemented yet
- Metadata fetch failures do not stop the review run
- Image/video reading settings are saved for future use but not implemented yet
- No model list fetch yet

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
