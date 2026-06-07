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
- Provider
- Endpoint URL
- Model

The API key is stored separately in Obsidian SecretStorage and is not written to `data.json`.

Current AI-related settings are preparation only:

- Provider: `openai-compatible`
- Default endpoint URL: `https://api.openai.com/v1`
- Default model: `gpt-4o-mini`
- No connection test yet
- No model list fetch yet
- No real API call yet

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
