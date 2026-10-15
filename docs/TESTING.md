# Testing ZotExtract

ZotExtract has three test layers:

1. **Unit smoke tests** (`npm test`) — fast, deterministic, the primary gate.
2. **Docker Zotero GUI lifecycle E2E** (`npm run test:zotero:docker`) — hermetic GUI run against a
   mock provider; the release gate when Docker is available.
3. **Manual verification** — including the optional check against a real model server.

## 1. Automated unit smoke tests

Run:

```bash
npm test
```

This executes `test/test_runner.js`, a Node-based mock of the Zotero runtime. It is not a full
Zotero integration test, but it catches basic regressions in question-set migration, session
creation, full-text context building, session result storage/export, CSV hardening, and provider
calls.

## 2. Build test

Run:

```bash
./build.sh
```

Expected result: `zotextract.xpi` is created in the repo root. The E2E harness
(`content/zotextract-e2e.js`) is excluded unless `ZOTEXTRACT_INCLUDE_E2E=1`.

## 3. Docker Zotero GUI lifecycle E2E (mock provider)

```bash
npm run test:zotero:docker
```

This is the **canonical GUI gate**. It builds the Docker Zotero capsule and runs a hermetic GUI
lifecycle check against a **deterministic mock provider** — no real model and no outbound network,
so it is repeatable and finishes in minutes:

1. `npm test`
2. `./build.sh`
3. fake local OpenAI-compatible provider on container-local `127.0.0.1`
4. Xvfb + fluxbox
5. clean isolated Zotero profile under `test-artifacts/docker-zotero/profile`
6. Zotero Plugins Manager opened through `Tools -> Plugins`
7. `zotextract.xpi` installed through `Install Plugin From File...`, or through the isolated-profile fallback when Fluxbox does not raise the file picker
8. Zotero relaunched with the GUI-installed plugin active
9. first-install provider setup tip is visible and captured
10. ZotExtract Settings opened through `Edit -> Settings`
11. provider pane opened in the real settings UI; deterministic provider values configured by the runtime harness
12. fixture PDF items created through Zotero APIs after settings are complete
13. ZotExtract Sessions list captured
14. empty session matrix captured with title/context-size rows and Add extractions hint
15. Add extractions three-column question workflow captured and asserted
16. Add Papers return-to-library hint captured and asserted
17. single PDF selected, right-clicked, `Start ZotExtract session...` chosen, session workspace captured, result cells verified
18. multiple PDFs selected, right-clicked, `Start ZotExtract session...` chosen, session workspace captured, result cells verified
19. XLSX/CSV/TSV/JSON/Markdown/HTML export paths created from completed session results and checked for the no-raw-full-text contract
20. Zotero item context menu checked implicitly by the runtime: no item-level ZotExtract export command is registered
21. ZotExtract uninstalled through Plugins Manager and uninstall confirmation

Expected artifacts are written under `test-artifacts/docker-zotero-<version>/`, including
`report.md`, `extension-check.json`, `preferences-check.json`, `runtime-check.json`,
`runtime-e2e-result.json`, `uninstall-check.json`, Zotero logs, window listings, `ui-stage-*.json`,
and screenshots covering install, provider setup tip, provider settings, sessions list, empty
matrix, Add extractions, the Add Papers return-to-library hint, single-paper session, multi-paper
session, export, and uninstall.

### The mock provider

The lifecycle uses `scripts/fake-openai-server.mjs`, a small deterministic OpenAI-compatible server
that returns the same shapes the plugin parses in production:

- the sectioned `## reasoning / ## context / ## answer` format used by the default prompts;
- `L00xxxx` line citations drawn from the line IDs actually present in the request context, so
  evidence extraction and PDF-reader navigation are exercised when saved source locations exist;
- an evidence-collection branch when the prompt is a `Window X/Y (range)` scan, covering both
  single-window and oversized-paper collection paths;
- an explicit-JSON branch when a caller asks for JSON output.

Run it standalone (e.g. to point a manual Zotero at it) with:

```bash
npm run fake-openai            # listens on http://127.0.0.1:8789
```

Then set the ZotExtract API base URL to `http://127.0.0.1:8789/v1`.

### Pinning a specific Zotero release line

```bash
bash scripts/run-zotero-version-smoke.sh 7.0.32
bash scripts/run-zotero-version-smoke.sh 8.0.4
bash scripts/run-zotero-version-smoke.sh 9.0.4
bash scripts/run-zotero-version-smoke.sh 10.0.6
```

Or set `ZOTERO_VERSION` and use a separate artifact directory:

```bash
ZOTERO_VERSION=7.0.32 ARTIFACTS="$PWD/test-artifacts/docker-zotero-7.0.32" npm run test:zotero:docker
ZOTERO_VERSION=8.0.4 ARTIFACTS="$PWD/test-artifacts/docker-zotero-8.0.4" npm run test:zotero:docker
ZOTERO_VERSION=9.0.4 ARTIFACTS="$PWD/test-artifacts/docker-zotero-9.0.4" npm run test:zotero:docker
ZOTERO_VERSION=10.0.6 ARTIFACTS="$PWD/test-artifacts/docker-zotero-10.0.6" npm run test:zotero:docker
```

Collection coverage starts a session from one collection, adds an overlapping collection, and,
on Zotero 10, starts a session from two selected collections. The resulting paper IDs must match
the selection without duplicates. Evidence is recorded in `collectionActions` in the runtime
result and `ui-14d-collection-session.png`.

Sidebar coverage clicks the native library disclosure control to collapse, expand, and collapse
again, and expands a nested collection. Each state measures the sessions section against the
last row in Zotero's collection model, checks for overlap, and captures a `ui-12b-sidebar-*.png`
screenshot. Measurements are recorded in `librarySidebar` in the runtime result.

To run the real Zotero GUI lifecycle independently of the Node mock tests, set
`ZOTEXTRACT_SKIP_UNIT_TESTS=1`. The report explicitly records the skipped gate; this is not a
passing full release gate. Leave the variable unset for release verification.

### Watching the UI live

```bash
WATCH_UI=1 WATCH_PAUSE_SECONDS=60 npm run test:zotero:docker
```

Connect a VNC client to `127.0.0.1:5901`. This is raw VNC, not an HTTP page, so opening it in a
browser will show an empty/broken page.

If the command says the Docker engine is not reachable, start Docker Desktop or enable Docker
Desktop WSL integration and rerun it.

## 4. Manual Zotero smoke test

1. Build the extension with `./build.sh`.
2. Open Zotero 7, 8, 9, or 10.
3. Install `zotextract.xpi` via Tools → Add-ons → Install Add-on From File.
4. Restart Zotero.
5. Configure provider settings in Zotero preferences:
   - Local Ollama-compatible endpoint: `http://localhost:11434/v1`
   - Or another OpenAI-compatible endpoint.
6. Select one item with a PDF attachment.
7. Right-click -> **Start ZotExtract session...**.
8. Confirm the **ZotExtract Sessions** tab opens with a matrix containing title and context-size rows.
9. Click **Add extractions**, choose a question or a whole question set, and click **Add to my ZotExtract session**.
10. Confirm the question editor only exposes **Question**, **Question set**, and **Prompt**.
11. Run the session and confirm result cells appear in the matrix.
12. Confirm the context-size row shows direct/two-pass versus sliding evidence mode, evidence-window count, active per-request token limit, and average extraction time after a completed run.
13. Confirm completed results return sectioned output with `## reasoning`, `## context`, and `## answer`, while the session grid displays the final answer first with collapsed evidence/reasoning details.
14. When a result cell shows a **PDF** evidence action, open it and confirm Zotero's native PDF reader opens for the cited evidence location.
    In Zotero 8–10, confirm the named session tab remains visible. Click it to return to the
    same grid and scroll position. Repeat while the session updates, and verify updates do
    not select the session tab while you are reading. Close and reopen the tab from the
    library, then confirm the saved session and results are still available.
    Open Zotero's all-tabs menu, filter for the session, and select it from the menu.
    Check the Zotero log for tab-menu errors and PDF-reader readiness errors.
    Open a second session and switch between both named tabs and a PDF. Verify separate grids
    and scroll positions, reopening an existing session without duplicating its tab, and keeping
    a question picker open while another session updates. **Back to sessions** and all five status
    filters must show the overview beside the library sidebar without creating tabs. Close one
    session tab and reopen it; deleting a session must close only that session's tab.
15. Confirm full-text results cite line IDs such as `L000123`; all full-text papers should first scan line-numbered evidence context, with oversized papers using overlapping windows, and then answer from the collected evidence.
16. Open advanced settings and confirm reasoning effort defaults to **None**, remains configurable, and the full-text character cap defaults to 400,000 and is editable.
17. Confirm the final-answer and evidence-collection prompt templates are editable and use `{{question}}` / `{{context}}` placeholders.
18. Resize a paper column and a question row, reopen the session, and confirm the dimensions persist.
19. Start a batch of 2-3 items and confirm progress, skips, and errors are understandable.
20. Export from the completed session view and confirm files are created under the Zotero profile `zotextract-exports/` directory without raw full text.
21. Confirm the Zotero item context menu has no item-level ZotExtract export command.

### Optional: verifying against a real model server

The fake provider rejects unsupported GPT-6 completion-token, temperature, and reasoning
parameters and logs request settings without messages or authorization headers. To exercise
OpenAI-specific request handling locally, set `ZOTEXTRACT_PROVIDER_NAME=OpenAI`, use a test
hostname mapped to loopback for `ZOTEXTRACT_PROVIDER_BASE_URL`, and set
`ZOTEXTRACT_PROVIDER_MODEL=gpt-6-astra`. A literal localhost URL intentionally selects the
local-provider compatibility path. The GUI harness also checks the GPT-6 variants with
none/minimal/medium reasoning and the existing GPT-5 and GPT-4 request paths in this mode.
These checks validate request compatibility against the mock; they do not evaluate hosted
model answers.

Real-model verification uses the installed plugin. Point the ZotExtract API base URL at any
OpenAI-compatible endpoint (LM Studio, Ollama, llama.cpp, Jan, or a hosted provider), and run a
session following the manual smoke test. The mocked Docker lifecycle (#3) remains the automated
release gate.

## Session layout after updates

Install an updated build while Zotero is running. Open a specific session and confirm its
header, toolbar, workspace, and footer fill the native tab content area. Check empty,
one-paper, and three-paper sessions at narrow and maximized window sizes, including the
question picker and the return to the library overview. The stylesheet URL changes when
ZotExtract loads, preventing Zotero from reusing styles from the previous build.

## Privacy checks

- Sessions should send Zotero metadata and indexed PDF full text only to the configured chat-completions endpoint.
- No file-upload provider path is exposed or configured by ZotExtract.
- Exported XLSX/CSV/TSV/JSON/Markdown/HTML should contain metadata, structured records, and evidence pointers, not raw PDF text.
- No telemetry or hidden network calls should exist.
