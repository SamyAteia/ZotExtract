#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TOOLS="$ROOT/.tools"
ARTIFACTS="$ROOT/test-artifacts"
PROFILE="$ROOT/.zotero-test-profile"
REPORT="$ARTIFACTS/zotero-test-env-report.md"
ZOTERO_VERSION="${ZOTERO_VERSION:-7.0.15}"
ARCH="$(uname -m)"
ZOTERO_URL="${ZOTERO_URL:-https://download.zotero.org/client/release/${ZOTERO_VERSION}/Zotero-${ZOTERO_VERSION}_linux-x86_64.tar.bz2}"

mkdir -p "$TOOLS" "$ARTIFACTS" "$PROFILE"

have() { command -v "$1" >/dev/null 2>&1; }
log() { printf '[zotero-test-env] %s\n' "$*"; }

cat > "$REPORT" <<EOF_REPORT
# Zotero clickable test environment report

Generated: $(date -Is)

## System

- Architecture: $ARCH

## Paths

- Repo: $ROOT
- Tools: $TOOLS
- Test profile: $PROFILE
- Artifacts: $ARTIFACTS

## Host tooling

EOF_REPORT

for cmd in node npm curl tar bzip2 xvfb-run xdotool wmctrl import gnome-screenshot; do
  if have "$cmd"; then
    echo "- $cmd: $(command -v "$cmd")" >> "$REPORT"
  else
    echo "- $cmd: MISSING" >> "$REPORT"
  fi
done

ZOTERO_BIN="${ZOTERO_BIN:-}"
if [[ -z "$ZOTERO_BIN" ]]; then
  if have zotero; then
    ZOTERO_BIN="$(command -v zotero)"
  elif [[ -x "$TOOLS/Zotero_linux-x86_64/zotero" ]]; then
    ZOTERO_BIN="$TOOLS/Zotero_linux-x86_64/zotero"
  fi
fi

if [[ -z "$ZOTERO_BIN" ]]; then
  if [[ "$ARCH" != "x86_64" && "$ARCH" != "amd64" ]]; then
    echo >> "$REPORT"
    echo "## Blocker" >> "$REPORT"
    echo "This server is $ARCH, while upstream Zotero Linux desktop builds are x86_64. Do not download/run the x86_64 tarball here unless an explicit emulation/container strategy is chosen." >> "$REPORT"
    echo "Recommended safe options:" >> "$REPORT"
    echo "- run clickable Zotero tests on an x86_64 local/CI runner; or" >> "$REPORT"
    echo "- use a local-only x86_64 VM/container with no published ports; or" >> "$REPORT"
    echo "- use this environment for unit and build checks." >> "$REPORT"
    exit 2
  fi
  log "No Zotero binary found. Attempting local download to .tools/."
  ARCHIVE="$TOOLS/zotero.tar.bz2"
  if have curl; then
    curl -L --fail "$ZOTERO_URL" -o "$ARCHIVE"
    tar -xjf "$ARCHIVE" -C "$TOOLS"
    ZOTERO_BIN="$TOOLS/Zotero_linux-x86_64/zotero"
  else
    echo >> "$REPORT"
    echo "## Blocker" >> "$REPORT"
    echo "No Zotero binary and curl is unavailable, so the local Zotero tarball could not be downloaded." >> "$REPORT"
    exit 2
  fi
fi

if [[ ! -x "$ZOTERO_BIN" ]]; then
  echo >> "$REPORT"
  echo "## Blocker" >> "$REPORT"
  echo "Zotero binary is not executable: $ZOTERO_BIN" >> "$REPORT"
  exit 2
fi

ZOTERO_REAL_BIN="$(dirname "$ZOTERO_BIN")/zotero-bin"
if [[ -f "$ZOTERO_REAL_BIN" ]] && file "$ZOTERO_REAL_BIN" | grep -q 'x86-64' && [[ "$ARCH" != "x86_64" && "$ARCH" != "amd64" ]]; then
  echo >> "$REPORT"
  echo "## Blocker" >> "$REPORT"
  echo "Found Zotero binary at $ZOTERO_BIN, but its embedded zotero-bin is x86_64 while this host is $ARCH." >> "$REPORT"
  echo "Do not run it directly on this server. Use an x86_64 runner/VM/container or keep this server to unit/build tests." >> "$REPORT"
  exit 2
fi

echo >> "$REPORT"
echo "## Zotero" >> "$REPORT"
echo "- Binary: $ZOTERO_BIN" >> "$REPORT"

log "Building extension."
(cd "$ROOT" && ./build.sh >/tmp/zotextract-build.log)
cp /tmp/zotextract-build.log "$ARTIFACTS/build.log"
echo "- Extension: $ROOT/zotextract.xpi" >> "$REPORT"

cat > "$ARTIFACTS/manual-clickthrough-checklist.md" <<'EOF_CHECKLIST'
# Manual clickable Zotero smoke checklist

Use only the isolated test profile.

1. Launch Zotero with the generated profile.
2. Install `zotextract.xpi` into the profile if not already installed.
3. Restart Zotero if prompted.
4. Confirm ZotExtract appears in preferences and registers `Start ZotExtract session...` in the item context menu.
5. Add/import a small public sample PDF item.
6. Configure provider:
   - API base URL: `http://127.0.0.1:8789/v1`
   - model: `fake-model`
   - API key: blank or `test`
7. Select the PDF item.
8. Right-click -> `Start ZotExtract session...`.
9. Confirm the ZotExtract Sessions tab opens.
10. Add an extraction question and run the session.
11. Confirm result cells appear in the session matrix.
12. Export from the completed session view.
13. Run a non-PDF/no-attachment case and verify the error/skip message is understandable.
14. Capture screenshots and note results in this file or a sibling report.
EOF_CHECKLIST

LAUNCH_CMD=("$ZOTERO_BIN" -profile "$PROFILE" -no-remote)

echo >> "$REPORT"
echo "## Launch command" >> "$REPORT"
printf '```bash\n' >> "$REPORT"
printf '%q ' "${LAUNCH_CMD[@]}" >> "$REPORT"
printf '\n```\n' >> "$REPORT"

if have xvfb-run; then
  echo >> "$REPORT"
  echo "## Automation status" >> "$REPORT"
  echo "xvfb-run is available. Use it with xdotool/wmctrl for headless Zotero UI automation when those tools are installed." >> "$REPORT"
elif [[ -n "${DISPLAY:-}" || -n "${WAYLAND_DISPLAY:-}" ]]; then
  echo >> "$REPORT"
  echo "## Automation status" >> "$REPORT"
  echo "A desktop display appears available. Launch manually/with the platform automation available in this environment." >> "$REPORT"
else
  echo >> "$REPORT"
  echo "## Automation blocker" >> "$REPORT"
  echo "No xvfb-run and no DISPLAY/WAYLAND_DISPLAY detected. Install/enable GUI automation before click-through testing." >> "$REPORT"
fi

log "Report written: $REPORT"
cat "$REPORT"
