@echo off
setlocal
echo Building ZotExtract...

if "%ZOTEXTRACT_OUTPUT_XPI%"=="" (
    set "OUTPUT_XPI=zotextract.xpi"
) else (
    set "OUTPUT_XPI=%ZOTEXTRACT_OUTPUT_XPI%"
)
if exist "%OUTPUT_XPI%" del "%OUTPUT_XPI%"
set "STAGE=%TEMP%\zotextract-build-%RANDOM%-%RANDOM%"
mkdir "%STAGE%" || exit /b 1

copy manifest.json "%STAGE%\" >nul || exit /b 1
copy chrome.manifest "%STAGE%\" >nul || exit /b 1
copy bootstrap.js "%STAGE%\" >nul || exit /b 1
copy icon.svg "%STAGE%\" >nul || exit /b 1
xcopy /E /I /Q content "%STAGE%\content" >nul || exit /b 1
xcopy /E /I /Q locale "%STAGE%\locale" >nul || exit /b 1

if not "%ZOTEXTRACT_INCLUDE_E2E%"=="1" del "%STAGE%\content\zotextract-e2e.js" 2>nul
for /R "%STAGE%" %%F in (*.stackdump *.map) do del "%%F"

powershell -NoProfile -ExecutionPolicy Bypass -Command "Compress-Archive -Path '%STAGE%\manifest.json', '%STAGE%\chrome.manifest', '%STAGE%\bootstrap.js', '%STAGE%\icon.svg', '%STAGE%\content', '%STAGE%\locale' -DestinationPath '%OUTPUT_XPI%' -Force"
set "BUILD_STATUS=%ERRORLEVEL%"
rmdir /S /Q "%STAGE%" 2>nul
if not "%BUILD_STATUS%"=="0" exit /b %BUILD_STATUS%

echo Build complete: %OUTPUT_XPI%
