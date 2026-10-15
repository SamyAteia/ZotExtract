#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Create a GitHub release for an already-tagged ZotExtract version.

Usage:
  bash scripts/create-github-release.sh [options]

Options:
  --version VERSION       Release version. Defaults to package.json version.
  --tag TAG               Git tag. Defaults to v$VERSION.
  --asset PATH            XPI asset to upload. Defaults to zotextract.xpi.
  --title TITLE           GitHub release title. Defaults to "ZotExtract $VERSION".
  --notes-file PATH       Release notes file. Defaults to the matching CHANGELOG.md section.
                         Download and installation instructions are prepended in either case.
  --draft                 Create the release as a draft.
  --prerelease            Mark the release as a prerelease.
  --dry-run               Print the release command without creating it.
  --skip-package-check    Do not run scripts/check-xpi-contents.py.
  --skip-remote-check     Do not verify that the tag exists on origin.
  -h, --help              Show this help.

Expected workflow before running:
  1. Run tests and build zotextract.xpi.
  2. Commit release changes.
  3. Tag the release, for example v1.0.0.
  4. Push main and the tag to GitHub.
  5. Run this script.
EOF
}

die() {
  echo "ERROR: $*" >&2
  exit 1
}

info() {
  echo "==> $*"
}

quote_cmd() {
  local quoted=()
  local arg
  for arg in "$@"; do
    quoted+=("$(printf '%q' "$arg")")
  done
  printf '%s\n' "${quoted[*]}"
}

version_from_package() {
  if command -v node >/dev/null 2>&1; then
    node -e "process.stdout.write(require('./package.json').version)"
    return
  fi
  local py
  if py="$(python_bin)"; then
    "$py" -c 'import json; print(json.load(open("package.json", encoding="utf-8"))["version"], end="")'
    return
  fi
  local ps
  ps="$(powershell_bin)" || return 1
  "$ps" -NoProfile -ExecutionPolicy Bypass -Command '(Get-Content -Raw package.json | ConvertFrom-Json).version'
}

python_bin() {
  local candidate
  for candidate in python3 python py; do
    if command -v "$candidate" >/dev/null 2>&1 && "$candidate" -c 'import json, zipfile' >/dev/null 2>&1; then
      echo "$candidate"
      return 0
    fi
  done
  return 1
}

powershell_bin() {
  local candidate
  for candidate in pwsh powershell.exe powershell; do
    if command -v "$candidate" >/dev/null 2>&1; then
      echo "$candidate"
      return 0
    fi
  done
  return 1
}

check_xpi_contents() {
  local asset=$1
  local py
  if py="$(python_bin)"; then
    "$py" scripts/check-xpi-contents.py "$asset"
    return
  fi

  local ps
  ps="$(powershell_bin)" || die "python, python3, py, or PowerShell is required for the package-content check."
  "$ps" -NoProfile -ExecutionPolicy Bypass -Command '
param([string]$Archive)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.IO.Compression.FileSystem
$required = @(
  "content/zotextract.js",
  "content/zotextract-window.js",
  "content/zotextract.css",
  "content/zotextract-data.js",
  "content/zotextract-context.js",
  "content/zotextract-quote-recovery.js",
  "content/zotextract-runner.js",
  "content/zotextract-window-ui.js",
  "content/zotextract-session-ui.js",
  "content/zotextract-evidence-ui.js",
  "content/zotextract-progress.js",
  "content/zotextract-provider-runtime.js",
  "content/zotextract-session-export.js"
)
$forbiddenExact = @("content/zotextract-e2e.js")
$forbiddenSuffixes = @(".stackdump", ".map")
$zip = [IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $Archive))
try {
  $names = @($zip.Entries | ForEach-Object { $_.FullName })
  $missing = @($required | Where-Object { $names -notcontains $_ })
  $forbidden = @($names | Where-Object {
    $name = $_
    ($forbiddenExact -contains $name) -or ($forbiddenSuffixes | Where-Object { $name.EndsWith($_) })
  })
  if ($forbidden.Count) {
    [Console]::Error.WriteLine("Forbidden files found in archive:")
    $forbidden | ForEach-Object { [Console]::Error.WriteLine("  $_") }
    exit 1
  }
  if ($missing.Count) {
    [Console]::Error.WriteLine("Required files missing from archive:")
    $missing | ForEach-Object { [Console]::Error.WriteLine("  $_") }
    exit 1
  }
  Write-Host "${Archive}: $($names.Count) entries checked"
} finally {
  $zip.Dispose()
}
' "$asset"
}

extract_changelog_notes() {
  local version=$1
  local output=$2
  awk -v version="$version" '
    index($0, "## [" version "]") == 1 { in_section = 1; found = 1; next }
    in_section && /^## \[/ { exit }
    in_section { print }
    END { if (!found) exit 3 }
  ' CHANGELOG.md > "$output" || die "Could not find CHANGELOG.md section for $version."
  grep -q '[^[:space:]]' "$output" || die "CHANGELOG.md section for $version is empty."
}

verify_update_json() {
  local version=$1
  local tag=$2
  local asset_name=$3
  if command -v node >/dev/null 2>&1; then
    VERSION="$version" TAG_NAME="$tag" ASSET_NAME="$asset_name" node <<'NODE'
const fs = require('fs');
const version = process.env.VERSION;
const tag = process.env.TAG_NAME;
const assetName = process.env.ASSET_NAME;
const update = JSON.parse(fs.readFileSync('update.json', 'utf8'));
const addon = update.addons && update.addons['zotextract@nfdixcs.org'];
const entry = addon && Array.isArray(addon.updates) && addon.updates[0];
if (!entry) {
  console.error('update.json does not contain a zotextract@nfdixcs.org update entry.');
  process.exit(1);
}
if (entry.version !== version) {
  console.error(`update.json version is ${entry.version}, expected ${version}.`);
  process.exit(1);
}
const expectedPath = `/releases/download/${tag}/${assetName}`;
if (!String(entry.update_link || '').includes(expectedPath)) {
  console.error(`update.json update_link must contain ${expectedPath}.`);
  process.exit(1);
}
NODE
    return
  fi
  local py
  if py="$(python_bin)"; then
    VERSION="$version" TAG_NAME="$tag" ASSET_NAME="$asset_name" "$py" - <<'PY'
import json
import os
import sys

version = os.environ["VERSION"]
tag = os.environ["TAG_NAME"]
asset_name = os.environ["ASSET_NAME"]

with open("update.json", "r", encoding="utf-8") as f:
    update = json.load(f)

entry = update.get("addons", {}).get("zotextract@nfdixcs.org", {}).get("updates", [None])[0]
if not entry:
    print("update.json does not contain a zotextract@nfdixcs.org update entry.", file=sys.stderr)
    sys.exit(1)
if entry.get("version") != version:
    print(f"update.json version is {entry.get('version')}, expected {version}.", file=sys.stderr)
    sys.exit(1)
expected_path = f"/releases/download/{tag}/{asset_name}"
if expected_path not in str(entry.get("update_link", "")):
    print(f"update.json update_link must contain {expected_path}.", file=sys.stderr)
    sys.exit(1)
PY
    return
  fi

  local ps
  ps="$(powershell_bin)" || die "node, python, py, or PowerShell is required to validate update.json."
  "$ps" -NoProfile -ExecutionPolicy Bypass -Command '
param([string]$Version, [string]$Tag, [string]$AssetName)
$ErrorActionPreference = "Stop"
$update = Get-Content -Raw update.json | ConvertFrom-Json
$entry = $update.addons."zotextract@nfdixcs.org".updates[0]
if (-not $entry) {
  [Console]::Error.WriteLine("update.json does not contain a zotextract@nfdixcs.org update entry.")
  exit 1
}
if ($entry.version -ne $Version) {
  [Console]::Error.WriteLine("update.json version is $($entry.version), expected $Version.")
  exit 1
}
$expectedPath = "/releases/download/$Tag/$AssetName"
if (-not [string]$entry.update_link -or -not ([string]$entry.update_link).Contains($expectedPath)) {
  [Console]::Error.WriteLine("update.json update_link must contain $expectedPath.")
  exit 1
}
' "$version" "$tag" "$asset_name"
}

VERSION=""
TAG=""
ASSET="zotextract.xpi"
TITLE=""
NOTES_FILE=""
DRAFT=0
PRERELEASE=0
DRY_RUN=0
SKIP_PACKAGE_CHECK=0
SKIP_REMOTE_CHECK=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --version)
      VERSION="${2:-}"
      shift 2
      ;;
    --tag)
      TAG="${2:-}"
      shift 2
      ;;
    --asset)
      ASSET="${2:-}"
      shift 2
      ;;
    --title)
      TITLE="${2:-}"
      shift 2
      ;;
    --notes-file)
      NOTES_FILE="${2:-}"
      shift 2
      ;;
    --draft)
      DRAFT=1
      shift
      ;;
    --prerelease)
      PRERELEASE=1
      shift
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --skip-package-check)
      SKIP_PACKAGE_CHECK=1
      shift
      ;;
    --skip-remote-check)
      SKIP_REMOTE_CHECK=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "Unknown option: $1"
      ;;
  esac
done

[[ -n "$VERSION" ]] || VERSION="$(version_from_package)"
[[ -n "$VERSION" ]] || die "Could not determine release version."
[[ -n "$TAG" ]] || TAG="v$VERSION"
[[ -n "$TITLE" ]] || TITLE="ZotExtract $VERSION"

ASSET_NAME="$(basename "$ASSET")"
[[ "$ASSET_NAME" == "zotextract.xpi" ]] || die "The release asset must be named zotextract.xpi because update.json points to that file."
[[ -f "$ASSET" ]] || die "Release asset not found: $ASSET"
[[ -f CHANGELOG.md ]] || die "CHANGELOG.md not found."
[[ -f update.json ]] || die "update.json not found."

git rev-parse --is-inside-work-tree >/dev/null 2>&1 || die "Run this script from inside the Git repository."
if [[ "$DRY_RUN" == "1" ]]; then
  info "Dry run: tag availability checks are deferred until publication."
else
  git rev-parse -q --verify "refs/tags/$TAG^{}" >/dev/null || die "Local tag $TAG does not exist."
  if [[ "$SKIP_REMOTE_CHECK" != "1" ]]; then
    info "Checking that $TAG exists on origin..."
    git ls-remote --exit-code --tags origin "$TAG" >/dev/null || die "Tag $TAG was not found on origin. Push it first: git push origin $TAG"
  fi
fi

if [[ "$SKIP_PACKAGE_CHECK" != "1" ]]; then
  info "Checking XPI contents..."
  check_xpi_contents "$ASSET"
fi

info "Checking update.json..."
verify_update_json "$VERSION" "$TAG" "$ASSET_NAME"

if [[ "$DRY_RUN" != "1" ]]; then
  command -v gh >/dev/null 2>&1 || die "GitHub CLI (gh) is required."
  gh auth status >/dev/null || die "gh is not authenticated. Run: gh auth login"
  if gh release view "$TAG" >/dev/null 2>&1; then
    die "GitHub release $TAG already exists."
  fi
fi

TMP_NOTES=""
TMP_RELEASE_NOTES=""
trap '[[ -z "${TMP_NOTES:-}" ]] || rm -f "$TMP_NOTES"; [[ -z "${TMP_RELEASE_NOTES:-}" ]] || rm -f "$TMP_RELEASE_NOTES"' EXIT
if [[ -n "$NOTES_FILE" ]]; then
  [[ -f "$NOTES_FILE" ]] || die "Release notes file not found: $NOTES_FILE"
else
  TMP_NOTES="$(mktemp)"
  extract_changelog_notes "$VERSION" "$TMP_NOTES"
  NOTES_FILE="$TMP_NOTES"
fi

TMP_RELEASE_NOTES="$(mktemp)"
cat > "$TMP_RELEASE_NOTES" <<'EOF'
### Download and install

Download `zotextract.xpi` from **Assets** below.

**Firefox:** right-click `zotextract.xpi` and choose **Save Link As…**. A normal click makes Firefox try to install it as a browser extension and may show an unsigned-add-on warning. Save the file, then install it in Zotero; Firefox security settings do not need to be changed.

In Zotero, open **Tools → Plugins** (or **Add-ons**), click the gear icon, choose **Install Plugin From File…** (or **Install Add-on From File…**), and select the saved `.xpi`.

---

EOF
cat "$NOTES_FILE" >> "$TMP_RELEASE_NOTES"
NOTES_FILE="$TMP_RELEASE_NOTES"

CMD=(gh release create "$TAG" "$ASSET" --title "$TITLE" --notes-file "$NOTES_FILE")
[[ "$DRAFT" == "1" ]] && CMD+=(--draft)
[[ "$PRERELEASE" == "1" ]] && CMD+=(--prerelease)

if [[ "$DRY_RUN" == "1" ]]; then
  info "Dry run. Would execute:"
  quote_cmd "${CMD[@]}"
  info "Release notes preview:"
  sed -n '1,80p' "$NOTES_FILE"
  exit 0
fi

info "Creating GitHub release $TAG..."
"${CMD[@]}"
info "Release created:"
gh release view "$TAG" --json url -q .url
