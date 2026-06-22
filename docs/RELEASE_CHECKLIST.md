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

## Publishing

After tests pass, the release commit is on `main`, and the tag has been pushed, create the GitHub release and upload `zotextract.xpi` with:

```bash
npm run release:github
```

Use `npm run release:github -- --dry-run` to preview the `gh release create` command and the changelog section that will be used as release notes.

## Privacy and data handling

- Sessions send Zotero metadata and indexed PDF full text only to the configured chat-completions endpoint.
- No file-upload provider path is exposed or configured by ZotExtract.
- API keys are stored in the dedicated local Zotero preference, not inside provider JSON.
- No telemetry, hidden uploads, or third-party calls are added.
- Export files contain metadata, extracted fields, short evidence, and source/context details only.

## User-facing quality

- A new user can follow the core workflow without reading developer docs: configure a provider, create or open a session, add questions, run extraction, inspect results, and export.
- Provider setup is clear for both local and hosted endpoints, including useful discovery feedback and actionable errors when a model server is unavailable.
- Settings keep common provider and safety options easy to find, while advanced tuning stays available without dominating the first-use flow.
- Session screens remain readable with realistic paper/question counts and keep technical diagnostics compact.
- Results prioritize the final answer while keeping evidence, reasoning, source details, and PDF navigation available when relevant.
- Built-in questions and prompts are public-facing, domain-focused, and free of implementation artifacts, internal terminology, or hidden response-mode details.
- Batch runs, skipped items, failures, and exports report enough context for a user to decide what to do next.
- README, changelog, testing docs, `manifest.json`, `package.json`, and `update.json` match the shipped behavior and release version.

## Release scope

ZotExtract v1.0 is a local Zotero workflow tool focused on evidence-linked extraction sessions and structured local exports.
