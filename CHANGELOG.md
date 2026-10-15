# Changelog

All notable changes to ZotExtract will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.1] - 2026-10-15

### Fixed

- Enabled Zotero 10 installation and updates, and adapted collection actions to its multiple-collection selection API without duplicating shared papers.
- Recovered missing or incorrect evidence line ranges from unambiguous quotations, including passages wrapped across PDF lines. Unmatched model commentary is excluded from source evidence.
- Prevented numbers in evidence notes from being interpreted as citation ranges, and restricted unverified citations to their original evidence window.
- Clarified Firefox downloads in the installation guide, website, and generated release notes: save `zotextract.xpi` with **Save Link As…**, then install it in Zotero.
- Loaded quote recovery in the automated test environment and required the module in release packages.

### Changed

- Extended GUI lifecycle verification to Zotero 10 and collection actions, and updated Settings and Plugins Manager navigation for current Zotero layouts.

## [1.0.0] - 2026-06-22

First stable release.

### Added

- Zotero 7-9 plugin packaging with ZotExtract menus, preferences, and the main-window **ZotExtract Sessions** tab.
- ZotExtract-owned session workflow for selected items and collections, including draft sessions, adding papers to a session, running extraction cells, targeted reruns, and local session/result storage separate from Zotero item and collection data.
- Session matrix with papers as columns and extraction questions as rows, compact title and context-size metadata rows, horizontal scrolling, persisted column/row resizing, and completed/running/review states.
- Three-column **Add extractions** workflow for managing question sets, selecting whole sets or individual questions, and editing question names/prompts outside the Settings pane.
- Comparison-first built-in computer-science question sets: Overview & Scope, Methods & Data, Results & Evaluation, Limitations & Critique, and Reproducibility.
- Typed extraction questions with normalized output contracts for Yes/No/Unclear answers, deduplicated lists, and length-capped free text.
- OpenAI-compatible provider support for local and hosted endpoints, including OpenAI, OpenRouter, Google Gemini, Ollama, LM Studio, llama.cpp, Jan, and custom compatible APIs.
- Local provider discovery for common local model servers, plus configurable model, base URL, request timeout, context window, concurrency, reasoning effort, full-text character cap, system prompt, final-answer template, and evidence-collection template.
- Privacy-first provider storage: API keys stay in a dedicated local Zotero preference and are not duplicated in serialized provider JSON.
- Full-text extraction from Zotero metadata, title, abstract, and Zotero indexed PDF full text when available.
- Two-pass evidence workflow for every full-text extraction cell: ZotExtract first scans line-numbered source text for relevant cited context, then asks the model for the final answer from metadata plus collected evidence.
- Single-window and sliding-window evidence collection, fallback to full fitting context after an empty evidence pass, metadata-only fallback when full text is unavailable or too large, and warnings for truncation or context fallback.
- Compact context diagnostics showing direct/two-pass or sliding evidence mode, evidence-window count, active per-request token limit, and average extraction time after a run.
- Sectioned response parsing for `## reasoning`, `## context`, and `## answer`, plus compatibility parsing for structured JSON responses.
- Completed result cells that show the final answer first, keep answer text selectable/copyable, expose collapsed evidence, reasoning, and source details, and show a compact PDF evidence action when ZotExtract saved a Zotero PDF reader location for cited lines.
- Privacy-preserving session exports in XLSX, CSV, TSV, JSON, Markdown, and HTML from the completed session view.
- Export records with session metadata, paper snapshots, question snapshots, answers, visible reasoning, short cited evidence, warnings, and extra structured fields without raw PDF full text.
- Spreadsheet export hardening for CSV/TSV formula-like cell values.
- First-start provider setup hint, Settings-page local data purge, and docs for testing, prompt architecture, and release checks.
- Deterministic Docker Zotero GUI lifecycle E2E against a fake OpenAI-compatible provider, covering install, settings, first-start setup hint, session creation, Add extractions, single- and multi-paper runs, PDF evidence navigation, exports, and uninstall.

## [0.1.0-alpha] - 2026-02-25

Alpha release for early testing.

### Added

- Zotero item context menu for running ZotExtract on selected library items.
- Batch processing for multiple selected papers.
- Built-in prompt library with summary, methods/data, limitations, and figure/table extraction prompts.
- Custom question entry for one-off extraction prompts.
- Configurable OpenAI-compatible provider settings with local API key storage.
- Result notes saved under processed Zotero items.
- NFDIxCS branding and funding acknowledgement.

[1.0.1]: https://github.com/SamyAteia/ZotExtract/releases/tag/v1.0.1
[1.0.0]: https://github.com/SamyAteia/ZotExtract/releases/tag/v1.0.0
[0.1.0-alpha]: https://github.com/SamyAteia/ZotExtract/releases/tag/v0.1.0-alpha
