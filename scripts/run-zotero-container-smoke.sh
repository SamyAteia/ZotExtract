#!/usr/bin/env bash
set -euo pipefail

ROOT="${ROOT:-/workspace}"
ARTIFACTS="${ARTIFACTS:-$ROOT/test-artifacts/docker-zotero}"
PROFILE="${PROFILE:-$ARTIFACTS/profile}"
EXTENSION_XPI="${EXTENSION_XPI:-$ARTIFACTS/zotextract-e2e.xpi}"
fake_pid=""
zotero_pid=""
xvfb_pid=""
wm_pid=""
vnc_pid=""
mkdir -p "$ARTIFACTS" "$PROFILE" "${HOME:-/tmp}/.cache" "${XDG_RUNTIME_DIR:-/tmp/zotextract-runtime}"
chmod 700 "${XDG_RUNTIME_DIR:-/tmp/zotextract-runtime}" 2>/dev/null || true

REAL_PROVIDER="${ZOTEXTRACT_REAL_PROVIDER:-0}"
PROVIDER_NAME="${ZOTEXTRACT_PROVIDER_NAME:-Docker GUI Provider}"
PROVIDER_MODEL="${ZOTEXTRACT_PROVIDER_MODEL:-fake-model}"
PROVIDER_BASE_URL="${ZOTEXTRACT_PROVIDER_BASE_URL:-http://127.0.0.1:8789/v1}"
PROVIDER_API_KEY="${ZOTEXTRACT_PROVIDER_API_KEY:-test-docker-key}"
PROVIDER_TIMEOUT_SECONDS="${ZOTEXTRACT_PROVIDER_TIMEOUT_SECONDS:-120}"
PROVIDER_SYSTEM_PROMPT="${ZOTEXTRACT_PROVIDER_SYSTEM_PROMPT:-Docker GUI system prompt}"
PROVIDER_REASONING_EFFORT="${ZOTEXTRACT_PROVIDER_REASONING_EFFORT:-}"
FIXTURE_MANIFEST="${ZOTEXTRACT_E2E_FIXTURE_MANIFEST:-}"
DIRECT_SESSION_START="${ZOTEXTRACT_E2E_DIRECT_SESSION_START:-0}"
PROFILE_INSTALL_FALLBACK="${ZOTEXTRACT_E2E_PROFILE_INSTALL_FALLBACK:-1}"
XVFB_SCREEN="${XVFB_SCREEN:-2560x1440x24}"
if [ "$REAL_PROVIDER" = "1" ]; then
  SINGLE_RESULT_WAIT="${ZOTEXTRACT_SINGLE_RESULT_WAIT_SECONDS:-900}"
  MULTI_RESULT_WAIT="${ZOTEXTRACT_MULTI_RESULT_WAIT_SECONDS:-1800}"
else
  SINGLE_RESULT_WAIT="${ZOTEXTRACT_SINGLE_RESULT_WAIT_SECONDS:-180}"
  MULTI_RESULT_WAIT="${ZOTEXTRACT_MULTI_RESULT_WAIT_SECONDS:-240}"
fi

report="$ARTIFACTS/report.md"
log() { printf '[docker-zotero] %s\n' "$*"; }
fail() {
  echo >> "$report"
  echo "## Failure" >> "$report"
  echo "$*" >> "$report"
  echo "$*" >&2
  exit 1
}

js_string() {
  node -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "$1"
}

stop_zotero() {
  if [ -n "$zotero_pid" ] && ps -p "$zotero_pid" >/dev/null 2>&1; then
    kill "$zotero_pid" 2>/dev/null || true
    for _ in $(seq 1 25); do
      ps -p "$zotero_pid" >/dev/null 2>&1 || break
      sleep 1
    done
    ps -p "$zotero_pid" >/dev/null 2>&1 && kill -9 "$zotero_pid" 2>/dev/null || true
  fi
  pkill -TERM -f "/opt/zotero/(zotero|zotero-bin|plugin-container)" 2>/dev/null || true
  for _ in $(seq 1 15); do
    pgrep -f "/opt/zotero/(zotero|zotero-bin|plugin-container)" >/dev/null 2>&1 || break
    sleep 1
  done
  pkill -KILL -f "/opt/zotero/(zotero|zotero-bin|plugin-container)" 2>/dev/null || true
  rm -f "$PROFILE/.parentlock" "$PROFILE/lock" 2>/dev/null || true
  zotero_pid=""
}

launch_zotero() {
  local log_file="$1"
  /opt/zotero/zotero -ZoteroDebugText -profile "$PROFILE" -no-remote > "$log_file" 2>&1 &
  zotero_pid=$!
}

wait_for_file() {
  local path="$1"
  local seconds="$2"
  for _ in $(seq 1 "$seconds"); do
    [ -s "$path" ] && return 0
    sleep 1
  done
  return 1
}

wait_for_window() {
  local pattern="$1"
  local seconds="${2:-30}"
  for _ in $(seq 1 "$seconds"); do
    wmctrl -l | grep -Ei "$pattern" >/dev/null 2>&1 && return 0
    sleep 1
  done
  return 1
}

focus_window() {
  local pattern="$1"
  local window_id
  window_id="$(wmctrl -l | grep -Ei "$pattern" | awk '{print $1; exit}' || true)"
  if [ -n "$window_id" ]; then
    wmctrl -ir "$window_id" -b remove,hidden || true
    wmctrl -ia "$window_id" || true
    xdotool windowactivate --sync "$window_id" windowraise "$window_id" 2>/dev/null || true
    wmctrl -ir "$window_id" -b add,above || true
    sleep 1
  fi
  return 0
}

lower_window() {
  local pattern="$1"
  local window_id
  window_id="$(wmctrl -l | grep -Ei "$pattern" | awk '{print $1; exit}' || true)"
  if [ -n "$window_id" ]; then
    wmctrl -ir "$window_id" -b remove,above || true
  fi
}

maximize_window() {
  local pattern="$1"
  local window_id
  window_id="$(wmctrl -l | grep -Ei "$pattern" | awk '{print $1; exit}' || true)"
  if [ -n "$window_id" ]; then
    wmctrl -ia "$window_id" || true
    sleep 0.2
    wmctrl -ir "$window_id" -b add,maximized_vert,maximized_horz || true
    sleep 0.5
  fi
  return 0
}

focus_main_window() {
  focus_window " - Zotero$"
}

maximize_main_window() {
  maximize_window " - Zotero$"
}

dismiss_upgrade_banner_if_present() {
  case "${ZOTERO_VERSION:-}" in
    8.*|9.*|10.*)
      # Zotero 8+ clean profiles can show a first-upgrade banner that steals
      # focus from menu automation. This coordinate lands on "Done" when present
      # and on inert main-window space when absent.
      focus_main_window
      xdotool mousemove 952 111 click 1
      xdotool mousemove 2510 111 click 1
      sleep 0.5
      ;;
  esac
}

capture_ui() {
  local name="$1"
  local file="$ARTIFACTS/ui-$name.png"
  wmctrl -l > "$ARTIFACTS/ui-$name-windows.txt" 2>&1 || true
  scrot "$file" || true
  echo "- ui-$name.png" >> "$ARTIFACTS/ui-screenshots.txt"
}

type_text() {
  xdotool type --clearmodifiers --delay 1 "$1"
}

replace_field() {
  local x="$1"
  local y="$2"
  local value="$3"
  xdotool mousemove "$x" "$y" click 1
  sleep 0.2
  xdotool key ctrl+a
  sleep 0.1
  type_text "$value"
  sleep 0.2
}

replace_focused_field() {
  local value="$1"
  xdotool key ctrl+a
  sleep 0.1
  type_text "$value"
  sleep 0.2
}

open_plugins_manager_from_tools() {
  local capture_prefix="${1:-02}"
  for attempt in 1 2 3; do
    focus_main_window
    xdotool key Escape
    sleep 0.2
    if [ "$attempt" = "2" ]; then
      xdotool key alt+t
    else
      xdotool mousemove 154 38 click 1
    fi
    sleep 0.6
    capture_ui "${capture_prefix}-tools-menu-attempt-${attempt}"
    xdotool mousemove 190 126 click 1
    if wait_for_window "Plugins Manager" 8; then
      return 0
    fi
  done
  return 1
}

open_install_file_picker() {
  local picker_pattern="Select (add-on|plugin) to install|Select Add-on to Install|Open File|File Upload"
  local gear_pos gear_x gear_y
  for gear_pos in "1738 464" "1738 344" "1738 194" "1418 344" "1418 194" "1057 194" "1096 194" "1378 344"; do
    gear_x="${gear_pos% *}"
    gear_y="${gear_pos#* }"
    focus_window "Plugins Manager"
    xdotool mousemove "$gear_x" "$gear_y" click 1
    sleep 0.5
    capture_ui "04-plugins-gear-menu"
    xdotool key Down Down Down Return
    if wait_for_window "$picker_pattern" 5; then
      return 0
    fi
    xdotool key Escape
    sleep 0.3
  done

  focus_window "Plugins Manager"
  xdotool key Escape
  sleep 0.3
  xdotool key alt+f
  sleep 0.5
  xdotool key Return
  wait_for_window "$picker_pattern" 15
}

trigger_zotextract_from_context_menu() {
  local name="$1"
  local row_y="${2:-183}"
  local action_y="${3:-516}"
  local row_x=330
  if [ -n "${4:-}" ]; then
    read -r row_x row_y < <(node -e 'const p = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).details.contextMenuTarget; console.log(p.x, p.y)' "$4")
  fi
  xdotool mousemove "$row_x" "$row_y" click 3
  sleep 1
  capture_ui "$name-context-menu"
  # The ZotExtract actions sit at the bottom of Zotero's item context menu, but
  # their absolute y-coordinate shifts between Zotero versions and when the
  # item is inside a collection. Select the second-to-last entry instead.
  xdotool key --clearmodifiers End Up Return || xdotool mousemove 391 "$action_y" click 1
}

write_fixture_pdf() {
  node - "$ARTIFACTS/fixture.pdf" <<'NODE'
const fs = require('fs');

const outputPath = process.argv[2];
const text = 'ZotExtract GUI Fixture Paper full text. This cache lets the plugin exercise full-text mode deterministically. This deterministic PDF text provides enough coordinate coverage for ZotExtract evidence navigation in the Docker GUI lifecycle.';
const escapePdfText = value => String(value).replace(/([\\()])/g, '\\$1');
const stream = [
  'BT',
  '/F1 12 Tf',
  '72 700 Td',
  `(${escapePdfText(text)}) Tj`,
  'ET',
  ''
].join('\n');
const objects = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
  `<< /Length ${Buffer.byteLength(stream, 'utf8')} >>\nstream\n${stream}endstream`,
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
];
const offsets = [0];
let pdf = '%PDF-1.4\n';
objects.forEach((body, index) => {
  offsets[index + 1] = Buffer.byteLength(pdf, 'utf8');
  pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
});
const xrefOffset = Buffer.byteLength(pdf, 'utf8');
pdf += `xref\n0 ${objects.length + 1}\n`;
pdf += '0000000000 65535 f \n';
for (let i = 1; i <= objects.length; i++) {
  pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
}
pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
fs.writeFileSync(outputPath, pdf);
NODE
}

write_e2e_prefs() {
  local start_delay_ms=1000
  local real_provider_pref=false
  local direct_session_pref=false
  local artifact_dir expected_name expected_base expected_model expected_api_key expected_timeout expected_system_prompt fixture_manifest
  local provider_reasoning_effort
  local simple_question_name simple_question_set_name simple_question_prompt multi_question_count
  [ "$REAL_PROVIDER" = "1" ] && real_provider_pref=true
  [ "$DIRECT_SESSION_START" = "1" ] && direct_session_pref=true
  artifact_dir="$(js_string "$ARTIFACTS")"
  expected_name="$(js_string "$PROVIDER_NAME")"
  expected_base="$(js_string "$PROVIDER_BASE_URL")"
  expected_model="$(js_string "$PROVIDER_MODEL")"
  expected_api_key="$(js_string "$PROVIDER_API_KEY")"
  expected_timeout="$(js_string "$PROVIDER_TIMEOUT_SECONDS")"
  expected_system_prompt="$(js_string "$PROVIDER_SYSTEM_PROMPT")"
  fixture_manifest="$(js_string "$FIXTURE_MANIFEST")"
  provider_reasoning_effort="$(js_string "$PROVIDER_REASONING_EFFORT")"
  simple_question_name="$(js_string "${ZOTEXTRACT_E2E_SIMPLE_QUESTION_NAME:-}")"
  simple_question_set_name="$(js_string "${ZOTEXTRACT_E2E_SIMPLE_QUESTION_SET_NAME:-}")"
  simple_question_prompt="$(js_string "${ZOTEXTRACT_E2E_SIMPLE_QUESTION_PROMPT:-}")"
  multi_question_count="$(js_string "${ZOTEXTRACT_E2E_MULTI_QUESTION_COUNT:-}")"
  mkdir -p "$PROFILE"
  cat > "$PROFILE/user.js" <<PREFS
user_pref("extensions.autoDisableScopes", 0);
user_pref("extensions.enabledScopes", 15);
user_pref("extensions.startupScanScopes", 15);
user_pref("xpinstall.signatures.required", false);
user_pref("extensions.zotextract.e2e.enabled", true);
user_pref("extensions.zotextract.e2e.mode", "gui-lifecycle");
user_pref("extensions.zotextract.e2e.artifactDir", $artifact_dir);
user_pref("extensions.zotextract.e2e.startDelayMs", $start_delay_ms);
user_pref("extensions.zotextract.e2e.realProvider", $real_provider_pref);
user_pref("extensions.zotextract.e2e.directSessionStart", $direct_session_pref);
user_pref("extensions.zotextract.e2e.expectedProviderName", $expected_name);
user_pref("extensions.zotextract.e2e.expectedProviderBaseUrl", $expected_base);
user_pref("extensions.zotextract.e2e.expectedProviderModel", $expected_model);
user_pref("extensions.zotextract.e2e.expectedProviderApiKey", $expected_api_key);
user_pref("extensions.zotextract.e2e.expectedProviderTimeoutSeconds", $expected_timeout);
user_pref("extensions.zotextract.e2e.expectedProviderSystemPrompt", $expected_system_prompt);
user_pref("extensions.zotextract.e2e.fixtureManifest", $fixture_manifest);
user_pref("extensions.zotextract.e2e.providerReasoningEffort", $provider_reasoning_effort);
user_pref("extensions.zotextract.e2e.simpleQuestionName", $simple_question_name);
user_pref("extensions.zotextract.e2e.simpleQuestionSetName", $simple_question_set_name);
user_pref("extensions.zotextract.e2e.simpleQuestionPrompt", $simple_question_prompt);
user_pref("extensions.zotextract.e2e.multiQuestionCount", $multi_question_count);
PREFS
}

verify_installed_extension() {
  node - "$PROFILE/extensions.json" <<'NODE'
const fs = require('fs');
const file = process.argv[2];
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const addon = (data.addons || []).find(a => a.id === 'zotextract@nfdixcs.org');
if (!addon) {
  console.error('zotextract@nfdixcs.org was not found in extensions.json');
  process.exit(1);
}
if (addon.active === false || addon.userDisabled === true || addon.appDisabled === true) {
  console.error(`ZotExtract discovered but disabled: ${JSON.stringify({
    active: addon.active,
    userDisabled: addon.userDisabled,
    appDisabled: addon.appDisabled,
    pendingUninstall: addon.pendingUninstall
  })}`);
  process.exit(1);
}
console.log(JSON.stringify({
  id: addon.id,
  version: addon.version,
  active: addon.active,
  location: addon.location,
  path: addon.path
}, null, 2));
NODE
}

install_extension_into_profile() {
  mkdir -p "$PROFILE/extensions"
  cp "$EXTENSION_XPI" "$PROFILE/extensions/zotextract@nfdixcs.org.xpi"
  rm -f "$PROFILE/extensions.json" "$PROFILE/extensions.ini" "$PROFILE/addonStartup.json.lz4"
  rm -rf "$PROFILE/startupCache"
}

verify_gui_configured_prefs() {
  node - "$PROFILE/prefs.js" <<'NODE'
const fs = require('fs');
const prefs = fs.readFileSync(process.argv[2], 'utf8');
function pref(name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = prefs.match(new RegExp(`user_pref\\("${escaped}",\\s*(.+?)\\);`));
  if (!match) return undefined;
  return JSON.parse(match[1]);
}
const providerRaw = pref('extensions.zotextract.provider');
const apiKey = pref('extensions.zotextract.apiKey');
if (!providerRaw) {
  console.error('extensions.zotextract.provider was not written to prefs.js');
  process.exit(1);
}
const provider = JSON.parse(providerRaw);
const expected = {
  name: process.env.ZOTEXTRACT_PROVIDER_NAME || 'Docker GUI Provider',
  baseUrl: process.env.ZOTEXTRACT_PROVIDER_BASE_URL || 'http://127.0.0.1:8789/v1',
  model: process.env.ZOTEXTRACT_PROVIDER_MODEL || 'fake-model',
  timeoutSeconds: Number(process.env.ZOTEXTRACT_PROVIDER_TIMEOUT_SECONDS || 120),
  systemPrompt: process.env.ZOTEXTRACT_PROVIDER_SYSTEM_PROMPT || 'Docker GUI system prompt'
};
for (const [key, value] of Object.entries(expected)) {
  if (provider[key] !== value) {
    console.error(`Provider ${key} mismatch: expected ${value}, got ${provider[key]}`);
    process.exit(1);
  }
}
if (provider.apiKey !== undefined) {
  console.error('Provider JSON should not duplicate the API key.');
  process.exit(1);
}
if (provider.fileEndpoint !== undefined) {
  console.error('Provider JSON should not include the fileEndpoint setting.');
  process.exit(1);
}
const expectedReasoningEffort = process.env.ZOTEXTRACT_PROVIDER_REASONING_EFFORT || '';
if (expectedReasoningEffort && provider.reasoningEffort !== expectedReasoningEffort) {
  console.error(`Provider reasoningEffort mismatch: expected ${expectedReasoningEffort}, got ${provider.reasoningEffort}`);
  process.exit(1);
}
if (provider.maxTextCharacters !== 400000) {
  console.error(`Provider maxTextCharacters mismatch: expected 400000, got ${provider.maxTextCharacters}`);
  process.exit(1);
}
const expectedApiKey = process.env.ZOTEXTRACT_PROVIDER_API_KEY || 'test-docker-key';
if (apiKey !== expectedApiKey) {
  console.error(`Provider apiKey mismatch: expected ${expectedApiKey} in dedicated pref, got ${apiKey}`);
  process.exit(1);
}
console.log(JSON.stringify({ provider }, null, 2));
NODE
}

verify_runtime_result() {
  node - "$ARTIFACTS/runtime-e2e-result.json" <<'NODE'
const fs = require('fs');
const result = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (!result.ok) {
  console.error(JSON.stringify(result, null, 2));
  process.exit(1);
}
const requiredExportFormats = ['xlsx', 'csv', 'tsv', 'json', 'markdown', 'html'];
if (!result.exportPaths || requiredExportFormats.some(format => !result.exportPaths[format]) || result.exportRecordCount < 2) {
  console.error('Expected XLSX/CSV/TSV/JSON/Markdown/HTML export paths with at least two records in runtime result.');
  console.error(JSON.stringify(result.exportPaths || null, null, 2));
  process.exit(1);
}
for (const step of ['settings-completed-through-ui', 'fixture-items-created', 'collection-session-actions-covered', 'new-session-screens-covered', 'single-session-completed', 'evidence-pdf-covered', 'multi-session-completed', 'export-completed']) {
  if (!Array.isArray(result.steps) || !result.steps.includes(step)) {
    console.error(`Runtime result did not include required step: ${step}`);
    console.error(JSON.stringify(result.steps || null, null, 2));
    process.exit(1);
  }
}
const sourceMappedCells = [...(result.singleCells || []), ...(result.multiCells || [])]
  .filter(cell => cell && cell.lineSourceMap && cell.lineSourceMap.records > 0);
if (!sourceMappedCells.length) {
  console.error('Expected at least one completed result cell with line source-map data.');
  console.error(JSON.stringify({
    singleLineSourceDiagnostics: result.singleLineSourceDiagnostics || null,
    multiLineSourceDiagnostics: result.multiLineSourceDiagnostics || null,
    singleCells: result.singleCells || null,
    multiCells: result.multiCells || null
  }, null, 2));
  process.exit(1);
}
const coordinateAware = sourceMappedCells.some(cell => cell.lineSourceMap.hasCoordinates);
console.log(JSON.stringify({
  ok: result.ok,
  mode: result.mode,
  coordinateAwareLineSourceMap: coordinateAware,
  steps: result.steps,
  itemIDs: result.itemIDs,
  draftSessionId: result.draftSessionId,
  singleSessionId: result.singleSessionId,
  multiSessionId: result.multiSessionId,
  singleCells: result.singleCells,
  multiCells: result.multiCells,
  singleLineSourceDiagnostics: result.singleLineSourceDiagnostics,
  multiLineSourceDiagnostics: result.multiLineSourceDiagnostics,
  exportPaths: result.exportPaths,
  exportRecordCount: result.exportRecordCount
}, null, 2));
NODE
}

verify_uninstalled_extension() {
  node - "$PROFILE/extensions.json" <<'NODE'
const fs = require('fs');
const data = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const addon = (data.addons || []).find(a => a.id === 'zotextract@nfdixcs.org');
if (addon && addon.active !== false && addon.userDisabled !== true && addon.pendingUninstall !== true) {
  console.error(`ZotExtract still appears enabled after uninstall: ${JSON.stringify({
    active: addon.active,
    userDisabled: addon.userDisabled,
    appDisabled: addon.appDisabled,
    pendingUninstall: addon.pendingUninstall
  })}`);
  process.exit(1);
}
console.log(JSON.stringify({
  uninstalled: !addon,
  addon: addon ? {
    active: addon.active,
    userDisabled: addon.userDisabled,
    appDisabled: addon.appDisabled,
    pendingUninstall: addon.pendingUninstall
  } : null
}, null, 2));
NODE
}

rm -f \
  "$ARTIFACTS/npm-test.log" \
  "$ARTIFACTS/build.log" \
  "$ARTIFACTS/fake-openai.log" \
  "$ARTIFACTS/fake-openai-health.json" \
  "$ARTIFACTS/real-provider-models.json" \
  "$ARTIFACTS/real-provider-health.log" \
  "$ARTIFACTS/xvfb.log" \
  "$ARTIFACTS/fluxbox.log" \
  "$ARTIFACTS/x11vnc.log" \
  "$ARTIFACTS/zotero-install.log" \
  "$ARTIFACTS/zotero-lifecycle.log" \
  "$ARTIFACTS/extension-check.json" \
  "$ARTIFACTS/preferences-check.json" \
  "$ARTIFACTS/runtime-e2e-result.json" \
  "$ARTIFACTS/runtime-check.json" \
  "$ARTIFACTS/uninstall-check.json" \
  "$ARTIFACTS/e2e-bootstrap-status.json" \
  "$ARTIFACTS"/ui-stage-*.json \
  "$ARTIFACTS"/ui-shell-*.json \
  "$ARTIFACTS/fixture.pdf" \
  "$ARTIFACTS/ui-screenshots.txt" \
  "$ARTIFACTS"/ui-*.png \
  "$ARTIFACTS"/ui-*-windows.txt
rm -rf "$PROFILE"
mkdir -p "$PROFILE"

cat > "$report" <<REPORT
# Docker Zotero GUI lifecycle report

Generated: $(date -Is)

## Environment

- Container arch: $(uname -m)
- Zotero version: ${ZOTERO_VERSION:-unknown}
- Display: $DISPLAY
- Repo: $ROOT
- Profile: $PROFILE
- Artifacts: $ARTIFACTS
- WATCH_UI: ${WATCH_UI:-0}
- UI_WALKTHROUGH: ${UI_WALKTHROUGH:-1}
- Real provider: $REAL_PROVIDER
- Provider: $PROVIDER_NAME ($PROVIDER_MODEL)
- Provider base URL: $PROVIDER_BASE_URL
- Provider reasoning effort: ${PROVIDER_REASONING_EFFORT:-provider default}
- Network note: runtime uses the wrapper's Docker network setting; fake-provider mode binds to container-local 127.0.0.1.
- Xvfb screen: ${XVFB_SCREEN:-2560x1440x24}

REPORT

cd "$ROOT"
echo "## npm test" >> "$report"
if [ "${ZOTEXTRACT_SKIP_UNIT_TESTS:-0}" = "1" ]; then
  log "Skipping Node mock tests; running the Zotero GUI lifecycle independently"
  echo "Skipped explicitly with ZOTEXTRACT_SKIP_UNIT_TESTS=1. This run verifies the GUI lifecycle only." >> "$report"
else
  log "Running npm test"
  npm test > "$ARTIFACTS/npm-test.log" 2>&1
  echo "Passed. Log: npm-test.log" >> "$report"
fi

log "Building extension"
ZOTEXTRACT_INCLUDE_E2E=1 ZOTEXTRACT_OUTPUT_XPI="$EXTENSION_XPI" ./build.sh > "$ARTIFACTS/build.log" 2>&1
echo >> "$report"
echo "## build" >> "$report"
echo "Built $EXTENSION_XPI with E2E harness enabled. Log: build.log" >> "$report"

trap 'for pid in "$fake_pid" "$zotero_pid" "$xvfb_pid" "$wm_pid" "$vnc_pid"; do [ -n "$pid" ] && kill "$pid" 2>/dev/null || true; done' EXIT
if [ "$REAL_PROVIDER" = "1" ]; then
  log "Checking real OpenAI-compatible provider at $PROVIDER_BASE_URL"
  if ! curl -fsS "${PROVIDER_BASE_URL%/}/models" > "$ARTIFACTS/real-provider-models.json" 2> "$ARTIFACTS/real-provider-health.log"; then
    fail "Real provider did not respond to ${PROVIDER_BASE_URL%/}/models from inside Docker. See real-provider-health.log."
  fi
  node - "$ARTIFACTS/real-provider-models.json" "$PROVIDER_MODEL" <<'NODE' || fail "Real provider did not list expected model $PROVIDER_MODEL. See real-provider-models.json."
const fs = require('fs');
const [file, expectedModel] = process.argv.slice(2);
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const models = Array.isArray(data.data) ? data.data.map(model => model.id || model.name) : [];
if (!models.includes(expectedModel)) {
  console.error(`Expected model ${expectedModel} was not listed by the real provider. Listed models: ${models.join(', ')}`);
  process.exit(1);
}
NODE
  echo >> "$report"
  echo "## real provider" >> "$report"
  echo "Using $PROVIDER_NAME at $PROVIDER_BASE_URL with model $PROVIDER_MODEL." >> "$report"
else
  log "Starting fake OpenAI-compatible server"
  FAKE_OPENAI_DELAY_MS="${FAKE_OPENAI_DELAY_MS:-1500}" PORT=8789 node scripts/fake-openai-server.mjs > "$ARTIFACTS/fake-openai.log" 2>&1 &
  fake_pid=$!
  for _ in $(seq 1 30); do
    if curl -fsS http://127.0.0.1:8789/health > "$ARTIFACTS/fake-openai-health.json" 2>> "$ARTIFACTS/fake-openai.log"; then
      break
    fi
    if ! ps -p "$fake_pid" >/dev/null 2>&1; then
      fail "Fake provider exited early. See fake-openai.log."
    fi
    sleep 1
  done
  [ -s "$ARTIFACTS/fake-openai-health.json" ] || fail "Fake provider did not become healthy. See fake-openai.log."
  echo >> "$report"
  echo "## fake provider" >> "$report"
  echo "Started on container-local http://127.0.0.1:8789 with FAKE_OPENAI_DELAY_MS=${FAKE_OPENAI_DELAY_MS:-1500}." >> "$report"
fi

log "Starting Xvfb and window manager"
Xvfb "$DISPLAY" -screen 0 "${XVFB_SCREEN}" > "$ARTIFACTS/xvfb.log" 2>&1 &
xvfb_pid=$!
sleep 1
fluxbox > "$ARTIFACTS/fluxbox.log" 2>&1 &
wm_pid=$!
sleep 2

if [ "${WATCH_UI:-0}" = "1" ]; then
  log "Starting x11vnc watch server on container port 5900"
  x11vnc -display "$DISPLAY" -listen 0.0.0.0 -rfbport 5900 -forever -shared -nopw > "$ARTIFACTS/x11vnc.log" 2>&1 &
  vnc_pid=$!
  echo >> "$report"
  echo "## watch UI" >> "$report"
  echo "WATCH_UI=1 enabled. Connect a VNC viewer to localhost on the host-mapped port, usually 127.0.0.1:5901." >> "$report"
fi

write_fixture_pdf
write_e2e_prefs
: > "$ARTIFACTS/ui-screenshots.txt"

single_row_y=216
multi_row_y=246
single_action_y=547
multi_action_y=554
plugin_actions_x=1044
plugin_actions_y=305
remove_action_x=951
remove_action_y=337
confirm_remove_x=815
confirm_remove_y=489
case "${ZOTERO_VERSION:-}" in
  8.*|9.*|10.*)
    multi_action_y=577
    plugin_actions_x=1406
    plugin_actions_y=452
    remove_action_x=1280
    remove_action_y=487
    confirm_remove_x=1138
    confirm_remove_y=650
    ;;
esac
case "${XVFB_SCREEN:-}" in
  25*|2560x*)
    plugin_actions_x=1726
    plugin_actions_y=452
    remove_action_x=1600
    remove_action_y=487
    confirm_remove_x=1458
    confirm_remove_y=650
    ;;
esac

log "Launching Zotero clean profile for GUI install"
launch_zotero "$ARTIFACTS/zotero-install.log"
sleep 12
ps -p "$zotero_pid" >/dev/null 2>&1 || fail "Zotero exited during clean-profile launch. See zotero-install.log."
maximize_main_window
capture_ui "01-clean-library"
dismiss_upgrade_banner_if_present
maximize_main_window
capture_ui "01-clean-library-ready"

log "Installing ZotExtract through the Plugins Manager UI"
open_plugins_manager_from_tools "02" || fail "Plugins Manager did not open from Tools -> Plugins."
focus_window "Plugins Manager"
sleep 2
capture_ui "03-plugins-manager-empty"

installed_via_profile=0
if open_install_file_picker; then
  focus_window "Select (add-on|plugin) to install|Select Add-on to Install|Open File|File Upload"
  sleep 1
  capture_ui "05-install-file-picker"

  xdotool key ctrl+l
  sleep 0.3
  type_text "$EXTENSION_XPI"
  sleep 0.3
  capture_ui "06-install-file-path"
  xdotool key Return
  sleep 5
  focus_window "Plugins Manager"
  capture_ui "07-plugin-installed-enabled"

  stop_zotero
  wait_for_file "$PROFILE/extensions.json" 30 || fail "Zotero did not write extensions.json after GUI install."
  verify_installed_extension > "$ARTIFACTS/extension-check.json" || fail "ZotExtract was not active after GUI install. See extension-check.json/profile/extensions.json."
else
  capture_ui "05-install-picker-not-opened"
  if [ "$PROFILE_INSTALL_FALLBACK" != "1" ]; then
    fail "Install-from-file picker did not open."
  fi
  log "Install-from-file picker did not open; installing ZotExtract directly into the isolated Docker profile"
  echo >> "$report"
  echo "## install fallback" >> "$report"
  echo "The Plugins Manager opened, but Fluxbox did not raise the install-from-file picker. The harness installed $EXTENSION_XPI into the isolated Docker profile extension directory and continued with product workflow coverage." >> "$report"
  stop_zotero
  install_extension_into_profile
  installed_via_profile=1
fi
rm -f \
  "$ARTIFACTS/runtime-e2e-result.json" \
  "$ARTIFACTS/e2e-bootstrap-status.json" \
  "$ARTIFACTS"/ui-stage-*.json

log "Relaunching Zotero for activated plugin lifecycle"
launch_zotero "$ARTIFACTS/zotero-lifecycle.log"
sleep 8
ps -p "$zotero_pid" >/dev/null 2>&1 || fail "Zotero exited during lifecycle launch. See zotero-lifecycle.log."
maximize_main_window
wait_for_file "$ARTIFACTS/ui-stage-plugin-loaded.json" 90 || fail "ZotExtract E2E did not report plugin-loaded after GUI install/relaunch."
if [ "$installed_via_profile" = "1" ]; then
  wait_for_file "$PROFILE/extensions.json" 30 || fail "Zotero did not write extensions.json after profile install."
  verify_installed_extension > "$ARTIFACTS/extension-check.json" || fail "ZotExtract was not active after profile install. See extension-check.json/profile/extensions.json."
fi
wait_for_file "$ARTIFACTS/ui-stage-provider-tip-visible.json" 90 || fail "ZotExtract provider setup tip was not visible after install/relaunch."
focus_main_window
capture_ui "08-provider-setup-tip-visible"
xdotool mousemove 647 251 click 1
sleep 0.3
case "${ZOTERO_VERSION:-}" in
  8.*|9.*|10.*)
    xdotool mousemove 952 111 click 1
    sleep 0.3
    ;;
esac

log "Configuring provider through ZotExtract settings UI"
focus_main_window
xdotool mousemove 686 211 click 1
if ! wait_for_window "Zotero Settings" 8; then
  focus_main_window
  xdotool mousemove 646 251 click 1
  sleep 0.4
  xdotool mousemove 66 38 click 1
  sleep 0.5
  capture_ui "09-edit-settings-menu"
  # Settings is the last Edit menu entry; Zotero 10 inserts Advanced Search above it.
  xdotool key End Return
  wait_for_window "Zotero Settings" 30 || fail "Zotero Settings did not open from provider tip or Edit -> Settings."
else
  capture_ui "09-provider-tip-opened-settings"
fi
focus_window "Zotero Settings"
sleep 2
capture_ui "10-settings-general"
focus_window "Zotero Settings"
# Preferences opens centered on the desktop. Use its own origin for the sidebar.
settings_window_id="$(wmctrl -l | grep -E 'Zotero Settings' | awk '{print $1; exit}')"
xdotool mousemove --window "$settings_window_id" 80 320 click 1
sleep 1
capture_ui "11-zotextract-settings-empty"

# Runtime E2E configures provider values after this visual settings checkpoint.
# Avoid coordinate-based typing here; if the preferences window is obscured,
# keystrokes can land in Zotero's library search and hide fixture papers.
capture_ui "12-provider-settings-visible"

focus_window "Zotero Settings"
xdotool key alt+F4
sleep 1
: > "$ARTIFACTS/ui-shell-settings-complete.json"
focus_main_window
xdotool key Escape

for state in collapsed expanded nested recollapsed; do
  wait_for_file "$ARTIFACTS/ui-stage-sidebar-$state.json" 120 || fail "Library sidebar $state layout check did not complete."
  capture_ui "12b-sidebar-$state"
  touch "$ARTIFACTS/ui-shell-sidebar-$state-captured.json"
done

wait_for_file "$ARTIFACTS/ui-stage-sessions-list-visible.json" 120 || fail "ZotExtract Sessions list did not open."
focus_main_window
sleep 1
capture_ui "13-sessions-list"
: > "$ARTIFACTS/ui-shell-sessions-list-captured.json"

wait_for_file "$ARTIFACTS/ui-stage-empty-session-visible.json" 120 || fail "Empty ZotExtract session workspace did not open."
focus_main_window
sleep 1
capture_ui "14-empty-session"
: > "$ARTIFACTS/ui-shell-empty-session-captured.json"

wait_for_file "$ARTIFACTS/ui-stage-library-click-return-covered.json" 120 || fail "Clicking Zotero My Library did not return from the ZotExtract session view."
focus_main_window
sleep 1
capture_ui "14b-library-return"
: > "$ARTIFACTS/ui-shell-library-return-captured.json"

wait_for_file "$ARTIFACTS/ui-stage-papers-click-return-covered.json" 120 || fail "Clicking Zotero papers collection did not return from the ZotExtract session view."
focus_main_window
sleep 1
capture_ui "14c-papers-return"
: > "$ARTIFACTS/ui-shell-papers-return-captured.json"

wait_for_file "$ARTIFACTS/ui-stage-collection-session-actions-covered.json" 120 || fail "ZotExtract collection session actions did not complete."
focus_main_window
sleep 1
capture_ui "14d-collection-session"
: > "$ARTIFACTS/ui-shell-collection-session-captured.json"

wait_for_file "$ARTIFACTS/ui-stage-question-picker-visible.json" 120 || fail "ZotExtract Pick Extractions view did not open."
focus_main_window
sleep 1
capture_ui "15-question-picker"
: > "$ARTIFACTS/ui-shell-question-picker-captured.json"

wait_for_file "$ARTIFACTS/ui-stage-add-papers-visible.json" 120 || fail "ZotExtract add-papers library return did not complete."
focus_main_window
sleep 1
capture_ui "16-add-papers-return"
: > "$ARTIFACTS/ui-shell-paper-picker-captured.json"

wait_for_file "$ARTIFACTS/ui-stage-single-ready.json" 120 || fail "ZotExtract E2E did not create/select the single fixture item."
focus_main_window
capture_ui "20-single-pdf-selected"

log "Starting single-PDF ZotExtract session through the item context menu"
if [ "$DIRECT_SESSION_START" = "1" ]; then
  log "Using direct E2E session start for single-paper fixture run"
else
  trigger_zotextract_from_context_menu "21-single" "$single_row_y" "$single_action_y" "$ARTIFACTS/ui-stage-single-ready.json"
fi
wait_for_file "$ARTIFACTS/ui-stage-single-session-opened.json" 120 || fail "Single ZotExtract session did not open."
focus_main_window
sleep 1
capture_ui "22-single-session-ready"
: > "$ARTIFACTS/ui-shell-single-session-ready-captured.json"
wait_for_file "$ARTIFACTS/ui-stage-single-session-completed.json" "$SINGLE_RESULT_WAIT" || fail "Single ZotExtract session did not create result cells."
focus_main_window
sleep 1
capture_ui "23-single-session-completed"
: > "$ARTIFACTS/ui-shell-single-session-completed-captured.json"
wait_for_file "$ARTIFACTS/ui-stage-evidence-pdf-opened.json" 120 || fail "ZotExtract evidence action did not open the PDF reader."
focus_main_window
sleep 0.4
capture_ui "23b-evidence-pdf"
: > "$ARTIFACTS/ui-shell-evidence-pdf-captured.json"

wait_for_file "$ARTIFACTS/ui-stage-multi-ready.json" 120 || fail "ZotExtract E2E did not select multiple fixture items."
focus_main_window
capture_ui "24-multiple-pdfs-selected"

log "Starting multi-PDF ZotExtract session through the item context menu"
if [ "$DIRECT_SESSION_START" = "1" ]; then
  log "Using direct E2E session start for multi-paper fixture run"
else
  trigger_zotextract_from_context_menu "25-multiple" "$multi_row_y" "$multi_action_y" "$ARTIFACTS/ui-stage-multi-ready.json"
fi
wait_for_file "$ARTIFACTS/ui-stage-multi-session-opened.json" 120 || fail "Multiple ZotExtract session did not open."
focus_main_window
sleep 1
capture_ui "26-multiple-session-ready"
: > "$ARTIFACTS/ui-shell-multi-session-ready-captured.json"
wait_for_file "$ARTIFACTS/ui-stage-multi-session-completed.json" "$MULTI_RESULT_WAIT" || fail "Multiple ZotExtract session did not create result cells."
focus_main_window
sleep 1
capture_ui "27-multiple-session-completed"
: > "$ARTIFACTS/ui-shell-multi-session-completed-captured.json"

case "${ZOTERO_VERSION:-}" in
  8.*|9.*|10.*)
    for stage in session-overview-in-library multiple-session-tabs; do
      wait_for_file "$ARTIFACTS/ui-stage-$stage.json" 120 || fail "Session tab navigation check $stage did not complete."
      capture_ui "$stage"
      touch "$ARTIFACTS/ui-shell-$stage-captured.json"
    done
    wait_for_window 'Delete ZotExtract session' 30 || fail "Fixture session delete confirmation did not open."
    capture_ui "session-delete-confirmation"
    focus_window 'Delete ZotExtract session'
    xdotool key Return
    ;;
esac

wait_for_file "$ARTIFACTS/runtime-e2e-result.json" 60 || fail "Runtime GUI lifecycle result was not written."
verify_runtime_result > "$ARTIFACTS/runtime-check.json" || fail "Runtime GUI lifecycle verification failed. See runtime-e2e-result.json."

log "Uninstalling ZotExtract through the Plugins Manager UI"
focus_main_window
open_plugins_manager_from_tools "29" || fail "Plugins Manager did not open for uninstall."
focus_window "Plugins Manager"
sleep 2
capture_ui "30-plugins-manager-before-uninstall"
uninstall_fallback=0
remove_dialog_opened=0
uninstall_attempt=0
for coords in \
  "$plugin_actions_x,$plugin_actions_y,$remove_action_x,$remove_action_y" \
  "1726,452,1600,487" \
  "1406,452,1280,487" \
  "1085,303,951,337" \
  "1044,305,951,337"; do
  uninstall_attempt=$((uninstall_attempt + 1))
  action_x="${coords%%,*}"
  rest="${coords#*,}"
  action_y="${rest%%,*}"
  rest="${rest#*,}"
  remove_x="${rest%%,*}"
  remove_y="${rest#*,}"
  xdotool key Escape || true
  sleep 0.2
  xdotool mousemove "$action_x" "$action_y" click 1
  sleep 0.5
  capture_ui "31-plugin-actions-menu-attempt-${uninstall_attempt}"
  xdotool mousemove "$remove_x" "$remove_y" click 1
  if wait_for_window "Remove ZotExtract" 4; then
    remove_dialog_opened=1
    break
  fi
done
if [ "$remove_dialog_opened" = "1" ]; then
  sleep 0.5
  capture_ui "32-uninstall-confirmation"
  confirmation_closed=0
  for coords in "$confirm_remove_x,$confirm_remove_y" "1138,650" "815,489"; do
    confirm_x="${coords%%,*}"
    confirm_y="${coords#*,}"
    xdotool mousemove "$confirm_x" "$confirm_y" click 1
    sleep 1
    if ! wait_for_window "Remove ZotExtract" 2; then
      confirmation_closed=1
      break
    fi
  done
  if [ "$confirmation_closed" = "1" ]; then
    sleep 3
    focus_window "Plugins Manager"
    capture_ui "33-plugin-uninstalled"
  else
    log "Remove confirmation did not close; falling back to isolated profile cleanup"
    uninstall_fallback=1
  fi
else
  log "Remove confirmation did not open; falling back to isolated profile cleanup"
  uninstall_fallback=1
fi

if [ "${WATCH_UI:-0}" = "1" ]; then
  log "WATCH_UI pause before cleanup (${WATCH_PAUSE_SECONDS:-20}s)"
  sleep "${WATCH_PAUSE_SECONDS:-20}"
fi

stop_zotero
wait_for_file "$PROFILE/prefs.js" 20 || fail "Zotero did not write prefs.js after GUI lifecycle."
verify_gui_configured_prefs > "$ARTIFACTS/preferences-check.json" || fail "ZotExtract provider settings were not persisted from the settings UI."
if [ "$uninstall_fallback" = "1" ]; then
  rm -f "$PROFILE/extensions/zotextract@nfdixcs.org.xpi" "$PROFILE/extensions.json" "$PROFILE/extensions.ini" "$PROFILE/addonStartup.json.lz4"
  rm -rf "$PROFILE/startupCache"
  cat > "$ARTIFACTS/uninstall-check.json" <<JSON
{
  "uninstalled": true,
  "method": "isolated-profile-cleanup"
}
JSON
else
  wait_for_file "$PROFILE/extensions.json" 20 || fail "Zotero did not write extensions.json after uninstall."
  verify_uninstalled_extension > "$ARTIFACTS/uninstall-check.json" || fail "ZotExtract still appears enabled after GUI uninstall."
fi

echo >> "$report"
echo "## Zotero GUI lifecycle E2E" >> "$report"
echo "The run installed ZotExtract through Plugins Manager -> Install Plugin From File or the isolated-profile fallback, verified the provider setup tip, opened ZotExtract Settings, configured the deterministic provider in the runtime harness, captured the Sessions list, empty matrix, collection actions, return-to-library and return-to-collection states, Pick Extractions, Add Papers, and native PDF evidence screens, opened single and multiple paper ZotExtract sessions from the item context menu, verified answer-only result cells and session exports, and removed ZotExtract through the Plugins Manager or isolated-profile cleanup." >> "$report"
echo "Extension install check: extension-check.json" >> "$report"
echo "Preference setup check: preferences-check.json" >> "$report"
echo "Runtime extraction/export check: runtime-check.json and runtime-e2e-result.json" >> "$report"
echo "Uninstall check: uninstall-check.json" >> "$report"
echo >> "$report"
echo "## UI screenshots" >> "$report"
cat "$ARTIFACTS/ui-screenshots.txt" >> "$report"

cat "$report"
