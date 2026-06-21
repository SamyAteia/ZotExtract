# ZotExtract public release checklist

Use this checklist before publishing a ZotExtract `.xpi` release.

## Required checks

- `npm test` passes.
- `bash ./build.sh` creates `zotextract.xpi`.
- `npm run test:zotero:docker` passes on a clean profile.
- Zotero 7 smoke passes: `bash scripts/run-zotero-version-smoke.sh 7.0.32`.
- Zotero 8 smoke passes: `bash scripts/run-zotero-version-smoke.sh 8.0.4`.
- Zotero 9 smoke passes: `bash scripts/run-zotero-version-smoke.sh 9.0.4`.
- The public `zotextract.xpi` does not include `content/zotextract-e2e.js`; only the Docker workflow opts into that harness.
- Docker artifacts include screenshots for install or isolated-profile install fallback, provider settings, sessions tab, empty/ready/completed session matrix, session export, and uninstall.
- Docker GUI lifecycle asserts and screenshots the first-install provider setup tip.
- Docker GUI lifecycle asserts the session matrix context-size row.
- Docker GUI lifecycle asserts and screenshots native PDF evidence navigation from a completed result cell.
- `test-artifacts/docker-zotero-<version>/runtime-e2e-result.json` reports `ok: true` for each release-line smoke.
- XLSX, CSV, TSV, JSON, Markdown, and HTML exports are present, are generated from session results, and omit raw PDF full text.

## Privacy and data handling

- Sessions send Zotero metadata and indexed PDF full text only to the configured chat-completions endpoint.
- No file-upload provider path is exposed or configured by ZotExtract.
- API keys are stored in the dedicated local Zotero preference, not inside provider JSON.
- No telemetry, hidden uploads, or third-party calls are added.
- Export files contain metadata, extracted fields, short evidence, and source/context details only.

## User-facing quality

- Settings page contains provider/model/safety configuration only; no extraction prompt catalog is exposed there.
- Settings can discover common local model servers and keeps detailed endpoint/security fields collapsed under Advanced.
- Advanced settings expose the full-text character cap and default it to 400,000 characters.
- Advanced settings default reasoning effort to None while leaving Provider default/minimal/low/medium/high configurable.
- Advanced settings expose editable final-answer and evidence-collection prompt templates with `{{question}}` and `{{context}}` placeholders.
- Default extraction prompts return sectioned output with `## reasoning`, `## context`, and `## answer`, which ZotExtract normalizes during parsing.
- Add extractions uses the three-column question-set/question/details workflow and hides technical output-type/context controls.
- Built-in extraction questions are domain-focused and do not expose hidden JSON response-mode artifacts.
- Completed result cells display the final answer first, make answer text selectable/copyable, expose collapsed evidence/reasoning details, and include a compact PDF evidence action for cited source-line ranges.
- The session matrix supports horizontal scrolling and persisted column/row resizing.
- The Zotero item context menu has no item-level ZotExtract export command.
- Skipped and failed batch items report actionable reasons.
- README, changelog, and testing docs match the shipped behavior.
- `manifest.json`, `package.json`, `update.json`, and changelog all use the release version.

## Release scope

ZotExtract v1.0 is a local Zotero workflow tool focused on evidence-linked extraction sessions and structured local exports.
