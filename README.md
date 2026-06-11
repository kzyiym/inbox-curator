![Inbox Curator — Auto-sort your Inbox](Repository%20Social%20Preview.jpg)

# Inbox Curator — Auto-sort your Inbox

AI-powered note review and auto-sort plugin for Obsidian. Automatically reviews, summarizes, and organizes notes in your inbox folder using LLM APIs (OpenAI, Gemini, or Anthropic).

Whether your inbox is filled with saved web articles, raw AI chat logs, rough quick notes, or simple URL links, Inbox Curator helps you process them in bulk — then auto-sorts them into Archive, Read Later, or Tasks.

- **Plugin ID**: `kzyiym-inbox-curator`
- **Version**: `1.0.0`
- **Min Obsidian Version**: `1.5.0`
- **Author**: [kzyiym](https://github.com/kzyiym)
- **License**: MIT

---

## Privacy Summary

Inbox Curator runs locally inside your Obsidian vault.

When AI review is enabled, selected note content and enabled attachment context (images, PDF text) are sent directly from your device to your configured AI provider (OpenAI, Gemini, or Anthropic). The developer does not receive, proxy, store, or monitor your notes, API keys, or usage data.

The plugin core contains no telemetry. Optional external pages (FAQ, Ko-fi, analytics) are separate from the plugin core and are disclosed in [External Service Disclosures](#external-service-disclosures) below.

API keys are stored using Obsidian's `SecretStorage` when available, falling back to in-memory session-only storage.

## Safety Summary

Inbox Curator is designed to be reversible and conservative.

- Notes are **never deleted automatically**.
- Delete candidates are suggestions only.
- Auto-sort can be disabled entirely.
- Review only mode disables all action execution.
- Recent auto-sort runs can be undone.
- Tasks require higher confidence (High) than Archive or Read Later (Medium or High).
- Test with a small folder before enabling bulk processing or auto-sort.

For details, see [Auto-sort Safety](#auto-sort-safety) below.

## Known Limitations

- AI-generated reviews may be incomplete or inaccurate.
- URL extraction may fail on paywalled, script-heavy, or blocked pages.
- PDF text extraction is experimental (first 5 pages, up to 10,000 characters).
- Image review requires a multimodal-capable model and is limited to 3 images (1 MB each).
- External AI API usage may incur provider costs.
- Large notes or attachments may be truncated or skipped to stay within context and payload limits.

---

## Features

- **AI Note Review**: Sends note content to a configurable AI provider and receives structured JSON verdicts with scores, summaries, credibility assessments, tags, and action recommendations.
- **Batch Processing**: Processes multiple files sequentially with configurable limits and rate limiting to prevent API token exhaustion.
- **URL Fetching & Article Extraction**: Detects URL-only notes, fetches HTML metadata (og:title, description), and extracts readable article text.
- **Attachment Awareness**: Detects linked attachments (images, audio, PDF, etc.). Supports sending images to multimodal models (OpenAI, Gemini, Anthropic) for visual review (up to 3 images, max 1MB payload per image). Features optional temporary in-memory resizing/compression for larger source files (up to 10MB) to fit within this 1MB limit without modifying original Vault files.
- **Experimental PDF Text Extraction**: Reads local PDF attachments (first 5 pages, up to 10,000 chars) using Obsidian's built-in PDF.js.
- **Auto-sort Actions**: Optionally auto-move files based on AI recommendations (Archive, Read Later, Task, Delete Candidate). Delete candidates are suggested only — never moved or deleted automatically.
- **Undo Auto-sort**: Recent auto-sort runs can be reverted with the "Undo last auto-sort run" command.
- **Automatic Watching**: Watches the configured folder for file changes with configurable debouncing. Polling fallback for missed events.
- **Deduplication**: Uses `ai_review_source_hash` in frontmatter to skip already-reviewed notes whose content hasn't changed.
- **i18n Support**: English and Japanese UI. Output language is configurable (auto-detect, force Japanese, force English, or match note language).
- **Custom Review Prompt**: Up to 3000 characters of additional instructions for the AI review.
- **Secure API Key Storage**: Uses Obsidian's native `SecretStorage` API. Falls back to in-memory session-only storage.

---

## Requirements

An account and API key from one of the following AI providers:

- **OpenAI** (or any OpenAI-compatible endpoint)
- **Google Gemini** (Native Gemini API)
- **Anthropic Claude** (Native Anthropic API)

> [!IMPORTANT]
> This plugin calls external AI APIs, which may incur usage costs depending on your provider's pricing plan.

---

## External Service Disclosures

In compliance with the Obsidian Community Plugin Guidelines, here is the full disclosure regarding network connection, data storage, and privacy for Inbox Curator:

- **Network Connections & External Services**: 
  - **AI Provider APIs**: Note contents, Base64-encoded image payloads, or experimental PDF texts are sent directly from your local device to your configured AI provider endpoint (OpenAI, Gemini, or Anthropic). No intermediary servers are involved.
  - **URL Article Fetching**: If a note consists only of a URL, the plugin directly fetches the raw HTML from the target web server to parse og:metadata and article text locally on your device.
  - **Ko-fi Widget (External Donation Service)**: Loaded strictly on the local FAQ page (`site/index.html`) via an iframe from `https://ko-fi.com` to display optional developer donation options. If blocked or declined, a safe HTTPS direct text link is provided as a fallback. The plugin's core functions are fully available without any donation.
  - **Google Analytics 4 (GA4) (External Analytics - FAQ Page Only)**: The local help/FAQ page (`site/index.html`) utilizes Google Analytics (tracking ID `G-H0NMPE813V`) strictly for collecting anonymous traffic statistics (page views, language, and theme choices) to improve documentation clarity.
    - **Opt-In Basis (Disabled by Default)**: Tracking is strictly opt-in and disabled by default. No scripts are loaded or data sent unless you explicitly consent via the toast banner shown on your first visit, or enable it using the toggle checkbox in the Privacy section. You can revoke permission at any time.
    - **No Impact on Usage**: Declining or blocking Google Analytics has **zero impact** on the functionality of the FAQ page or the plugin itself; all features remain 100% available. No note contents, credentials, or runtime telemetry from the plugin are ever transmitted.
- **Account Requirements**: You must possess a developer account and API key from OpenAI, Gemini, or Anthropic to configure reviews. The plugin itself requires no registration or subscription.
- **Server-side Telemetry**: The plugin core is **100% telemetry-free**. The developer does not collect, monitor, store, or transmit any analytical data, usage statistics, note contents, or error logs outside of your vault. The optional FAQ page (`site/index.html`) is the only exception, which uses Google Analytics 4 for anonymous traffic statistics on an opt-in basis (disabled by default).
- **Vault Access Limits**: The plugin interacts exclusively with files and directories located inside your Obsidian Vault (primarily within the configured *Watched Folder*). It utilizes Obsidian's standard `app.vault` API and does not access any data or files on your system outside of your vault.
- **Data & Credentials Storage**:
  - **API Keys**: Stored securely using Obsidian's native `SecretStorage` API. They are never written to `data.json` or synchronized across devices. If unavailable, keys are kept temporarily in-memory during the session.
  - **Review Logs**: Review verdicts are written strictly as local Markdown files (`*.ai-review.md`) in your vault.
- **Support & Developer Contact**: Maintained by **Kazuya Iyama** / **antidot** ([https://antidot.jp](https://antidot.jp)). Detailed troubleshooting and usage steps are maintained separately in our [FAQ & Help Document](#faq--help-document).

---

## Image Optimization for AI Review

When image reading is enabled, Inbox Curator can temporarily resize large image attachments in memory before sending them to the selected AI provider. This reduces skipped images while keeping the original Vault files unchanged. No external compression service is used.
This feature only applies to JPEG, PNG, and WebP images, and does not apply to PDFs or videos.

## Installation

### Via Obsidian Community Plugins (Recommended)

1. Open Obsidian **Settings** > **Community plugins** > **Browse**.
2. Search for `Inbox Curator`.
3. Click **Install**, then **Enable**.

### Manual Installation

1. Download `main.js`, `manifest.json`, `styles.css` from the [latest release](https://github.com/kzyiym/inbox-curator/releases).
2. Create `<vault>/.obsidian/plugins/kzyiym-inbox-curator/`.
3. Copy the files into that folder.
4. Enable the plugin in **Settings** > **Community plugins**.

---

## Ideal Workflow: Clip from Browser, Auto-Process in Obsidian

This plugin pairs perfectly with **[Obsidian Web Clipper](https://obsidian.com/clipper)** — the official browser extension for clipping web pages directly into your vault.

1. **Clip**: Browse any article, documentation, or post. Click the Web Clipper extension in your browser, select your Inbox folder as the destination, and clip it into Obsidian.
2. **Auto-Review**: With **Automatic Watching** and **Auto-review on Create** enabled in Inbox Curator settings, every clipped note is automatically queued for AI review the moment it lands in your Inbox — no manual intervention needed.
3. **Auto-Organize**: Enable **Auto-execute Actions** (Archive, Read Later, Task, Delete Candidate), and the plugin moves each reviewed note to its appropriate folder. Your Inbox stays clean with zero effort.

> [!TIP]
> This clip → auto-review → auto-organize pipeline is the intended workflow. Set it up once and let the plugin handle your daily reading intake.

---

## Quick Start

1. **Configure API Key**: Go to **Settings** > **Inbox Curator**, select your **Provider**, enter your API Key, and click **Test Connection**.
2. **Set Up Folders**:
   - **Watched Folder**: Where notes to curate live (e.g., `Inbox`).
   - **Review Output Folder**: Where AI-generated reviews are saved (e.g., `AI Reviews`).
3. **Run Review**:
   - `Inbox Curator: Review current note` — review the active note.
   - `Inbox Curator: Process watched folder` — batch-review all unprocessed notes.

> [!WARNING]
> Test with 1–2 notes in a small folder before bulk operations or enabling auto-execution.

---

## Commands

| Command ID | Display Name | Description |
|---|---|---|
| `review-current-note` | Review current note | AI-review the currently active note |
| `process-watched-folder` | Process watched folder | Batch-review all unprocessed notes in the watched folder |
| `execute-proposed-action` | Execute proposed action for current note | Execute the AI-recommended action on the active note |
| `undo-last-auto-sort` | Undo last auto-sort run | Revert the most recent auto-sort run |
| `cleanup-processing-markers` | Clean up processing markers | Remove stale 🤖 prefix markers from reviewed files |
 
---

## Settings

### Folders & Scope
| Setting | Default | Description |
|---|---|---|
| Watched Folder | `Inbox` | Folder monitored for curation |
| Review Output Folder | `AI Reviews` | Target folder for AI review notes |
| Suggested Folder Base Path | *(empty)* | Parent path for AI-suggested archive paths |
| Max Notes per Run | `10` | Limits batch run size (1–100) |
| Max Concurrent Reviews | `1` | Concurrent review jobs (1–8, Advanced) |

### Request Pacing (Advanced)
| Setting | Default | Description |
|---|---|---|
| Requests per Minute | `10` | API rate limit (1–60) |
| Delay Between Requests | `1000` ms | Pause between API calls (0–60000) |
| Request Timeout | `60000` ms | API call timeout (1000–300000) |

### Automation
| Setting | Default | Description |
|---|---|---|
| Automatic Watching | OFF | Watch folder for file changes |
| Auto-review on Create | OFF | Review on file creation |
| Auto-review on Modify | OFF | Review on file modification |
| Watch Debounce | `1500` ms | Debounce interval for file events |
| Polling Fallback | OFF | Periodic sweep fallback |
| Polling Interval | `30000` ms | Polling frequency |
| Show Processing Marker | OFF | Prefix `🤖 ` to filenames during processing |

### Auto-sort Actions
| Setting | Default | Description |
|---|---|---|
| Archive | OFF | Runs when confidence is Medium or High |
| Read Later | OFF | Runs when confidence is Medium or High |
| Tasks | OFF | Runs only when confidence is High |
| Delete Candidates | — | Suggested only. Never moved automatically. |

### Auto-sort Folders
| Setting | Default | Description |
|---|---|---|
| Read Later Folder | `Read Later` | Destination for read_later actions |
| Task Folder | `Tasks` | Destination for task actions |
| Delete Candidate Folder | `Delete Candidates` | Quarantine folder for delete candidates |

### Review Behavior
| Setting | Default | Description |
|---|---|---|
| Review Mode | `Advanced` | Advanced (structured JSON) / Auto-sort (plain-text) / Review only (no actions) |
| Custom Review Prompt | *(empty)* | Up to 3000 characters of additional AI instructions |

### Context Budget
| Setting | Default | Description |
|---|---|---|
| Budget Preset | `standard` | small (8K) / standard (32K) / large (64K) / custom |
| Custom Max Context Tokens | `32000` | For custom preset — total context window |
| Custom Max Input Tokens | `20000` | For custom preset — max input content |
| Custom Max Output Tokens | `4096` | For custom preset — max output tokens |
| Custom Safety Margin | `3000` | For custom preset — reserved headroom |

### Logging
| Setting | Default | Description |
|---|---|---|
| Log Level | `errors` | Off / Errors only / Operations (structured JSONL) |

### URL Extraction
| Setting | Default | Description |
|---|---|---|
| Fetch URL Metadata | ON | Fetch og:title, description, etc. |
| Extract URL Article Text | ON | Extract readable article content |
| Max Extracted Characters | `12000` | Truncation limit (Advanced) |

### Attachments & Media
| Setting | Default | Description |
|---|---|---|
| Read Images | OFF | Send images to multimodal AI |
| Optimize Images Before Sending | OFF | Resize/recompress large images to fit 1MB limit |
| Read Videos | OFF | Detect video attachments (Advanced) |
| Extract PDF Text (experimental) | OFF | Extract PDF text via PDF.js |

### AI Provider
| Setting | Description |
|---|---|
| Provider | OpenAI Compatible / Gemini Native / Anthropic Native |
| Endpoint URL | Customizable for OpenAI-compatible or advanced mode |
| Model | Model name for the selected provider |
| Instructions & Output Language | Auto-detect / Japanese / English / Same as note |
| API Key | Managed via SecretStorage (masked input, save/delete buttons) |
| Test Connection | Validate API key, endpoint, and model availability |

---

## Architecture Overview

```
Trigger (command / file event / polling)
  → ReviewQueue (async, concurrent, deduplicated)
    → ReviewPipeline (orchestrator):
        1. Read note content & parse frontmatter
        2. Detect URL-only notes → fetch HTML → extract article
        3. Detect attachments (images, PDF, etc.)
        4. Build AI prompt with full context
        5. Call provider API (OpenAI / Gemini / Anthropic)
        6. Parse & validate JSON response
        7. Map to domain model (ReviewResult)
        8. Write review output note (*.ai-review.md)
        9. Upsert frontmatter (ai_review_* fields)
        10. Auto-execute action (if configured)
```

The queue is **in-memory only** — persistence is handled via frontmatter hashes (`ai_review_source_hash`) on each note, avoiding restart-induced re-execution.

### File Structure

```
main.ts                       # Plugin entry point (root, not src/)
src/
├── commands.ts                # Command registration
├── settings.ts                # Settings tab UI
├── types.ts                   # Domain model types
├── secrets.ts                 # SecretStorage API key management
├── reviewPipeline.ts          # Core review orchestration
├── reviewResultMapper.ts      # AI response → ReviewResult
├── reviewResultValidator.ts   # Schema validation
├── reviewNormalizer.ts        # Simple-mode parsing & action normalization
├── reviewWriter.ts            # Review note generation
├── providerClient.ts          # Provider abstraction layer
├── openAiCompatible.ts        # OpenAI-compatible API client
├── gemini.ts                  # Google Gemini API client
├── anthropic.ts               # Anthropic Claude API client
├── urlExtraction.ts           # URL fetch & article extraction
├── attachmentContext.ts       # Attachment detection
├── actionLayer.ts             # Action execution
├── actionConfirmationModal.ts # Confirmation modal for destructive actions
├── undoAutoSort.ts            # Undo last auto-sort run
├── frontmatter.ts             # Frontmatter read/write
├── connectionTest.ts          # API connection tester
├── processingNotice.ts        # Persistent notice display
├── queue/
│   ├── queueTypes.ts          # Queue data types
│   ├── job.ts                 # Job creation
│   ├── reviewQueue.ts         # Async job queue
│   ├── rateLimiter.ts         # Rate limiting
│   └── retry.ts               # Exponential backoff
├── i18n/
│   ├── index.ts               # Locale detection
│   └── locales/
│       ├── en.ts              # English translations
│       └── ja.ts              # Japanese translations
├── utils/
│   ├── contentFilter.ts       # Context budget & content filtering
│   ├── autoSortHistory.ts     # Auto-sort history persistence
│   ├── promptInjection.ts     # Prompt injection signal detection
│   ├── logFiles.ts            # Shared log file utilities
│   ├── errorLog.ts            # Error logging & file writing
│   ├── operationLog.ts        # Structured operation logging (JSONL)
│   ├── folder.ts              # Folder creation & validation
│   ├── pdf.ts                 # PDF text extraction
│   └── imageOptimization.ts   # Image resize/recompress
└── types/
    └── obsidian-extra.d.ts    # Obsidian API type augmentations
```

---

## Development

```bash
# Install dependencies
pnpm install

# Type-check
pnpm check

# Build
pnpm build

# Watch mode
pnpm dev

# Run tests
pnpm test
```

### Project Status

All P0–P2 features are complete. See the [GitHub Issues](https://github.com/kzyiym/inbox-curator/issues) for planned work.

---

## Auto-sort Safety

Inbox Curator is designed to automate your inbox, not just summarize it. It can automatically move notes to Archive, Read Later, or Tasks when the AI review is reliable enough.

To keep automation reversible:

- It **never deletes notes automatically**.
- Delete candidates are **suggested only**.
- Auto-sort actions are **recorded** in `.inbox-curator/auto-sort-history.json`.
- **Recent auto-sort runs can be undone** with the `Inbox Curator: Undo last auto-sort run` command.
- **Tasks require higher confidence** (High) than Archive or Read Later (Medium or High).
- **Task auto-execution is blocked when prompt injection signals are detected** in the note content. Archive and Read Later may still auto-execute when their configured confidence and safety conditions are met, even if prompt injection signals are detected.
- For stricter safety, use **Review only mode** (Settings → Review Behavior → Review mode → Review only), which disables all auto-sort actions entirely.

## FAQ

### What is Inbox Curator?

Inbox Curator is an Obsidian plugin that uses AI (LLM APIs) to review, summarize, and auto-sort notes in your Inbox folder. It helps you process saved web articles, AI chat logs, quick notes, and URL links in bulk.

### Which AI providers are supported?

OpenAI (and OpenAI-compatible endpoints), Google Gemini (native API), and Anthropic Claude (native API). You need an API key from one of these providers.

### Will Inbox Curator delete my notes automatically?

No. Inbox Curator never deletes notes automatically. Delete candidates are suggestions only. By default, notes flagged as delete candidates remain in place. You may optionally configure auto-move of high-confidence delete candidates to a quarantine folder (`Delete Candidates`), but this is not permanent deletion.

### Can I undo auto-sorting?

Yes. Recent auto-sort runs can be undone with the command:

`Inbox Curator: Undo last auto-sort run`

Only move-based actions (Archive, Read Later, Task, suggested folder, Delete Candidates) are undoable. Manual Trash and Permanent Delete cannot be undone by Inbox Curator.

### Why are Archive and Read Later executed with Medium confidence?

Archive and Read Later are reversible, low-risk organization actions. Tasks require High confidence because they can influence user behavior and priorities.

### What are the review modes?

- **Standard (Advanced)**: Full structured AI review with scores, summaries, credibility assessments, tags, and action recommendations.
- **Simple (Auto-sort)**: Lightweight parsing focused on action classification only — ideal for auto-sorting.
- **Safe (Review only)**: Generates review output but disables all auto-sort actions entirely. Use this when you want to manually review AI suggestions before acting.

### How are API keys stored?

API keys are stored securely using Obsidian's native `SecretStorage` API. They are never written to `data.json` or synced. If `SecretStorage` is unavailable, keys are kept in-memory for the session only.

### Does the plugin collect telemetry?

No. The plugin core is 100% telemetry-free. The developer does not collect, monitor, or transmit any usage data, note contents, or error logs. The optional external FAQ page (`https://inbox-curator.antidot.jp/`) uses Google Analytics on an opt-in basis (disabled by default) — see [External Service Disclosures](#external-service-disclosures).

### What does the processing marker (🤖) do?

When enabled in settings, a `🤖` prefix is added to filenames while review is in progress. This is a visual indicator only and is automatically removed when processing completes. It is disabled by default because it may cause sync conflicts in vaults synchronized with third-party services.

### Can I review multiple notes at once?

Yes. You can:
- Process the entire watched folder with `Inbox Curator: Process watched folder`.
- Select multiple notes in the file explorer and choose context menu options like "Review selected notes as a collection" or "Review each selected note".

Collection review sends summaries of multiple notes to the AI together for cross-note analysis. Individual note review processes each note separately.

### Can I review images and attachments?

Yes, when image reading is enabled (`Settings → Attachments`). The plugin can send up to 3 images (max 1 MB each) to multimodal AI models for visual review. Optional in-memory image optimization accepts source images up to 10 MB and temporarily compresses them for AI review without modifying your original files. PDF text extraction is also available (experimental, first 5 pages, up to 10,000 characters).

### What happens with URL-only notes?

When a note contains only a URL, the plugin fetches the page's metadata (title, description, OG tags) and optionally extracts the readable article text. This works best with static HTML pages. Single-page applications (SPAs) that require JavaScript may yield incomplete results.

### What is prompt injection detection?

The plugin automatically scans note content for signals that attempt to manipulate the AI review prompt (prompt injection). When detected:
- Task auto-execution is blocked.
- Archive and Read Later may still auto-execute if their confidence and safety conditions are met.
- Review output includes a warning.

You can use Safe mode (Review only) for maximum protection.

### How does rate limiting work?

You can configure `Requests per minute` and `Delay between requests` in settings to control API usage. Combined with `Max notes per run` (1-100) and `Max concurrent reviews` (1-8), this prevents API rate-limit errors and manages costs.

### Does the plugin work on mobile?

No. Inbox Curator is desktop-only. The plugin manifest specifies `isDesktopOnly: true`.

### What is collection review?

Collection review analyzes a group of notes together, identifying themes, patterns, and relationships across notes. It can use existing individual reviews first (configurable) and include note excerpts when needed. Collection review output is saved to a separate configurable folder.

### Can I customize the review prompt?

Yes. You can add up to 3,000 characters of custom instructions in `Settings → Review Behavior → Additional Review Instructions`. This lets you tailor the AI review to your specific needs (e.g., focus on technical accuracy, prioritize certain topics, add domain-specific criteria).

### How does deduplication work?

After a review, the plugin writes an `ai_review_source_hash` to the note's frontmatter. On subsequent scans, if the note content hasn't changed (hash matches), the note is skipped. This prevents re-reviewing unchanged notes.

### What happens if a review fails?

Failed reviews are logged to rotating error log files in `.inbox-curator/logs/`. The queue continues processing remaining notes. You can configure log levels (`off`, `errors`, `operations`) in settings. Operation logs provide detailed execution traces for debugging.

### Are my notes sent to the developer?

No. Note content, images, and PDF text are sent directly from your device to your configured AI provider (OpenAI, Gemini, or Anthropic). No intermediary servers are involved. The developer cannot access your notes or API keys.

---

## FAQ & Help Document

We provide a comprehensive, interactive, and multi-language (English/Japanese) FAQ page to help you with common questions, troubleshoot issues, and understand plugin behaviors:

👉 **[Open FAQ Document](https://inbox-curator.antidot.jp/)** (Supports real-time search, category filtering, theme toggle, and accordion toggles)

*Note: The FAQ document is a supplementary helper document and does not constitute official product support. It is verified for Obsidian v1.0.0+ and Plugin v1.0.0+.*

---

## Feedback & Support

If you encounter any issues, have feature requests, or want to share your thoughts:

- **For GitHub users**: Please open an issue on [GitHub Issues](https://github.com/kzyiym/inbox-curator/issues) or start a discussion in [GitHub Discussions](https://github.com/kzyiym/inbox-curator/discussions).
- **For non-GitHub users**: If you do not have a GitHub account or are unfamiliar with GitHub, you can submit your bugs or suggestions using our [Feedback & Support Form (Tally)](https://tally.so/r/lbzMMW) (No account required).
- **Support the developer**: If you find this plugin useful, consider supporting development via [Ko-fi (External Donation Service)](https://ko-fi.com/kzyiym).

---

## License

[MIT](LICENSE)
