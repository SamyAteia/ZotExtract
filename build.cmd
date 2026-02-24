@echo off
echo Building ZotExtract...

if exist zotextract.xpi del zotextract.xpi
if exist zotextract.zip del zotextract.zip
powershell -NoProfile -Command "Compress-Archive -Path manifest.json, chrome.manifest, bootstrap.js, icon.svg, content, locale -DestinationPath zotextract.zip"
ren zotextract.zip zotextract.xpi

echo Build complete: zotextract.xpi
