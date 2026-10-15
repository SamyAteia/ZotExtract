# AGENTS.md - ZotExtract

ZotExtract is a Zotero 7-10 plugin for LLM-based information extraction from research PDFs.
It lets users create extraction sessions from selected Zotero items or collections, ask the
same questions across papers, review cited answers in Zotero, and export the results as
XLSX, CSV, TSV, JSON, Markdown, or HTML.

The `main` branch is the public release branch. Treat tracked files on `main` as public
project material.

## Core Features

- Zotero item and collection actions for starting ZotExtract sessions.
- A main-window **ZotExtract Sessions** tab for drafts, running sessions, completed sessions,
  reviewable results, and exports.
- **Add extractions** view for selecting built-in question sets or editing custom questions.
- Built-in question sets for Overview & Scope, Methods & Data, Results & Evaluation,
  Limitations & Critique, and Reproducibility.
- Provider settings for OpenAI-compatible APIs, including OpenAI, OpenRouter, Google Gemini,
  Ollama, LM Studio, llama.cpp, Jan, and custom endpoints.
- Local provider discovery for common local model servers.
- Indexed PDF text extraction through Zotero when available, with cited line ranges shown in
  completed result cells.
- PDF evidence buttons when Zotero can map cited lines back to a PDF reader location.
- Local session storage under ZotExtract-owned profile data.
- Session exports without raw PDF full text.

## Files That Ship

Release builds include only:

- `manifest.json`
- `chrome.manifest`
- `bootstrap.js`
- `icon.svg`
- `content/`
- `locale/`

Development files such as `scripts/`, `test/`, `docs/`, generated artifacts, and dependency
directories are not bundled into the `.xpi`.

## Main Runtime Files

- `bootstrap.js` - plugin lifecycle, content script loading, preferences pane registration, and
  E2E harness gating.
- `content/zotextract.js` - base ZotExtract object, shared constants, prompt templates, schema
  identifiers, and preference keys.
- `content/zotextract-window.js` - Zotero window lifecycle, context menu integration, and cleanup.
- `content/zotextract-data.js` - local JSON storage, question-set migration, session storage,
  session creation, and session edit helpers.
- `content/zotextract-context.js` - item metadata, indexed PDF text extraction, line numbering,
  context budgeting, token counting, and evidence-window planning.
- `content/zotextract-quote-recovery.js` - source quotation matching and evidence citation recovery.
- `content/zotextract-runner.js` - session run planning, extraction cell execution, concurrency,
  cancellation, and progress state.
- `content/zotextract-window-ui.js` - sessions tab shell, library navigation, layout positioning,
  setup hints, and preferences opening.
- `content/zotextract-session-ui.js` - sessions list, session workspace, table rendering, result
  cell rendering, and context summaries.
- `content/zotextract-evidence-ui.js` - table resize handlers, result-cell actions, PDF evidence
  opening, and the question picker.
- `content/zotextract-progress.js` - run progress overlay and HTML escaping helpers.
- `content/zotextract-provider-runtime.js` - OpenAI-compatible chat calls, response parsing,
  token budgeting, structured result construction, and source-line evidence handling.
- `content/zotextract-session-export.js` - XLSX, CSV, TSV, JSON, Markdown, and HTML exports.
- `content/prompt-presets.js` - built-in question sets.
- `content/provider-settings.js` - provider defaults and settings normalization.
- `content/preferences.js` and `content/preferences.xhtml` - Zotero settings pane.
- `content/zotextract-e2e.js` - in-Zotero E2E harness; excluded from normal release builds.

## Build

- Linux/macOS: `./build.sh`
- Windows: `build.cmd`
- npm wrapper: `npm run build`

The build creates `zotextract.xpi`. The E2E harness is excluded unless
`ZOTEXTRACT_INCLUDE_E2E=1` is set.

Keep the release version in sync across:

- `manifest.json`
- `package.json`
- `package-lock.json`
- `update.json`
- `CHANGELOG.md`

## Testing

Use the fastest relevant checks for the change, and run the full release gate before publishing.

- `npm test` - fast Node-based mock Zotero runtime. This is the primary development gate.
- `./build.sh` or `npm run build` - creates the release `.xpi`.
- `npm run test:package` - checks that the `.xpi` contains only expected release files.
- `npm run audit:tokens` - token-count audit for prompt/context budgeting.
- `npm run fake-openai` - local deterministic OpenAI-compatible mock provider.
- `npm run test:zotero:docker` - Docker GUI lifecycle test against the mock provider.
- `bash scripts/run-zotero-version-smoke.sh 7.0.32`
- `bash scripts/run-zotero-version-smoke.sh 8.0.4`
- `bash scripts/run-zotero-version-smoke.sh 9.0.4`
- `bash scripts/run-zotero-version-smoke.sh 10.0.6`

The Docker tests exercise Zotero installation, settings, session creation, question selection,
single- and multi-paper runs, PDF evidence navigation, exports, and uninstall.

## Privacy And Release Rules

- Do not add telemetry or hidden network calls.
- Do not add a plugin-managed PDF file-upload path.
- API keys must stay in Zotero preferences and must not be serialized into provider JSON.
- Exports must not contain raw PDF full text.
- Keep generated artifacts, dependency folders, local notes, secrets, and personal files out of
  tracked project files.

## Development Style

- Keep changes small and easy to test.
- Preserve Zotero 7-10 compatibility.
- Prefer the existing plain JavaScript and Zotero APIs over new frameworks.
- Use 4-space indentation in JavaScript.
- Add JSDoc for public methods when useful.
- Update `README.md`, `CHANGELOG.md`, `docs/TESTING.md`, or `docs/RELEASE_CHECKLIST.md` when
  behavior, release steps, or test coverage changes.
