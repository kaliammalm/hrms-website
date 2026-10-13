@echo off
REM ============================================================================
REM  Creates the release signing key for the RRD Group HRMS Android app (run ONCE).
REM  Every future update must be signed with this same key: back it up safely
REM  (e.g. company password manager + a USB drive). If it is lost, phones cannot
REM  update the app; staff would have to uninstall and reinstall.
REM ============================================================================
setlocal
set "KEYTOOL=C:\Program Files\Android\Android Studio\jbr\bin\keytool.exe"
if not exist "%KEYTOOL%" set "KEYTOOL=keytool"
set "KEYFILE=%USERPROFILE%\rrd-hrms-release.jks"
set "B64FILE=%USERPROFILE%\rrd-hrms-release-base64.txt"

if exist "%KEYFILE%" (
  echo A key already exists at %KEYFILE%
  echo Not overwriting it. Delete it yourself only if you are sure it was never used.
  goto :b64
)

echo You will be asked for a password (use 12+ characters and keep it safe),
echo then for your name and organisation details.
"%KEYTOOL%" -genkeypair -v -storetype PKCS12 -keystore "%KEYFILE%" -alias rrd-hrms -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=RRD Group HRMS, O=RRD Group, L=Chennai, ST=Tamil Nadu, C=IN"
if errorlevel 1 (
  echo Key creation failed.
  exit /b 1
)

:b64
powershell -NoProfile -Command "[Convert]::ToBase64String([IO.File]::ReadAllBytes('%KEYFILE%')) | Set-Content -NoNewline '%B64FILE%'"
echo.
echo Done.
echo   Key file:        %KEYFILE%
echo   Base64 for GitHub secret ANDROID_KEYSTORE_BASE64: %B64FILE%
echo.
echo Add these 4 secrets in GitHub (Settings - Secrets and variables - Actions):
echo   ANDROID_KEYSTORE_BASE64   = contents of %B64FILE%
echo   ANDROID_KEYSTORE_PASSWORD = the password you just typed
echo   ANDROID_KEY_ALIAS         = rrd-hrms
echo   ANDROID_KEY_PASSWORD      = the same password
echo Then delete %B64FILE% (the .jks is the file to back up).
endlocal
