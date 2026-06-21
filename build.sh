#!/usr/bin/env bash
set -euo pipefail

echo "Building ZotExtract..."
OUTPUT_XPI="${ZOTEXTRACT_OUTPUT_XPI:-zotextract.xpi}"
rm -f "$OUTPUT_XPI"

# Build
build_xpi() {
    local output_name=$1
    local output_path
    if [[ "$output_name" = /* ]]; then
        output_path="$output_name"
    elif [[ "$output_name" =~ ^[A-Za-z]:[\\/] ]]; then
        if command -v cygpath >/dev/null 2>&1; then
            output_path="$(cygpath -u "$output_name")"
        else
            output_path="$output_name"
        fi
    else
        output_path="$PWD/$output_name"
    fi
    local stage
    stage="$(mktemp -d "$PWD/.zotextract-build.XXXXXX")"
    trap "rm -rf \"${stage}\"" RETURN EXIT

    cp manifest.json chrome.manifest bootstrap.js icon.svg "$stage/"
    cp -R content locale "$stage/"
    if [[ "${ZOTEXTRACT_INCLUDE_E2E:-0}" != "1" ]]; then
        rm -f "$stage/content/zotextract-e2e.js"
    fi
    find "$stage" -type f \( -name '*.stackdump' -o -name '*.map' \) -delete

    echo "Building $output_name..."
    if command -v zip >/dev/null 2>&1; then
        (cd "$stage" && zip -r "$output_path" manifest.json chrome.manifest bootstrap.js icon.svg content locale)
    elif command -v python3 >/dev/null 2>&1 || command -v python >/dev/null 2>&1; then
        local python_bin
        python_bin="$(command -v python3 || command -v python)"
        STAGE="$stage" OUTPUT="$output_path" "$python_bin" - <<'PY'
import os
import zipfile

stage = os.environ["STAGE"]
output = os.environ["OUTPUT"]
roots = ["manifest.json", "chrome.manifest", "bootstrap.js", "icon.svg", "content", "locale"]

with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as zf:
    for root in roots:
        path = os.path.join(stage, root)
        if os.path.isdir(path):
            for dirpath, _, filenames in os.walk(path):
                for filename in filenames:
                    full = os.path.join(dirpath, filename)
                    arcname = os.path.relpath(full, stage).replace(os.sep, "/")
                    zf.write(full, arcname)
        else:
            zf.write(path, root)
PY
    elif command -v tar >/dev/null 2>&1 && tar --version 2>/dev/null | grep -qi 'bsdtar'; then
        (cd "$stage" && tar -a -cf "$output_path" manifest.json chrome.manifest bootstrap.js icon.svg content locale)
    elif command -v powershell.exe >/dev/null 2>&1; then
        powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Compress-Archive -Path '$stage/manifest.json', '$stage/chrome.manifest', '$stage/bootstrap.js', '$stage/icon.svg', '$stage/content', '$stage/locale' -DestinationPath '$output_path' -Force"
    elif command -v powershell >/dev/null 2>&1; then
        powershell -NoProfile -ExecutionPolicy Bypass -Command "Compress-Archive -Path '$stage/manifest.json', '$stage/chrome.manifest', '$stage/bootstrap.js', '$stage/icon.svg', '$stage/content', '$stage/locale' -DestinationPath '$output_path' -Force"
    else
        echo "Neither zip nor PowerShell is available; cannot build $output_name." >&2
        return 1
    fi
    echo "Done: $output_name"
}

build_xpi "$OUTPUT_XPI"

echo "Build complete: $OUTPUT_XPI"
