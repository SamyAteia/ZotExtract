#!/bin/bash
echo "Building ZotExtract..."
rm -f zotextract.xpi

# Build
build_xpi() {
    local output_name=$1
    echo "Building $output_name..."
    if command -v zip >/dev/null 2>&1; then
        zip -r "$output_name" manifest.json chrome.manifest bootstrap.js icon.svg content locale
    else
        powershell -NoProfile -Command "Compress-Archive -Path manifest.json, chrome.manifest, bootstrap.js, icon.svg, content, locale -DestinationPath zotextract.zip -Force"
        mv zotextract.zip "$output_name"
    fi
    echo "Done: $output_name"
}

build_xpi "zotextract.xpi"

echo "Build complete: zotextract.xpi"
