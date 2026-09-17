@echo off
setlocal
cd /d "%~dp0"
title BiliSummarize - Universal Video Downloader

rem ===========================================================================
rem  BiliSummarize - universal video / audio downloader (yt-dlp wrapper)
rem
rem  Usage:  download.bat "VIDEO_URL"
rem          - Quote the URL if it contains an ampersand (e.g. a list= param),
rem            otherwise cmd truncates it at that character.
rem          - Double-click to run: it will prompt you to paste a link,
rem            which avoids the quoting problem entirely.
rem
rem  Why is this file pure ASCII (no Chinese)?
rem    cmd decodes a .bat using the console codepage that is active while it
rem    reads. With multi-byte (UTF-8) text and a chcp in the middle of the
rem    file, cmd's byte offsets desync: it starts executing fragments from the
rem    middle of lines and can even loop ("Maximum setlocal recursion level
rem    reached"). Keeping the file ASCII-only makes decoding identical under
rem    every codepage, so this whole failure class is impossible.
rem    Chinese docs live in download.md instead. KEEP THIS FILE ASCII-ONLY.
rem
rem  Please only download content you are entitled to (your own material,
rem  licensed platforms, CC / public-domain works).
rem ===========================================================================

echo ============================================
echo   BiliSummarize - Video Downloader
echo ============================================
echo.

rem ------------------------------- SETTINGS --------------------------------
rem Paths are relative to this script's folder, so the repo can be cloned anywhere.
set "YTDLP=%~dp0tools\yt-dlp.exe"
set "FFMPEG=%~dp0tools\ffmpeg.exe"

rem Default output folder. Also covered by .gitignore.
set "OUT_DIR=%~dp0downloads"

rem Mode: video = best video+audio muxed to mp4 | audio = audio only, original container, no re-encode
set "MODE=video"

rem PLAYLIST=1 allows downloading a whole playlist; 0 downloads the single video only.
set "PLAYLIST=0"

rem SUBS=1 also downloads subtitles (manual preferred, auto fallback) as vtt.
set "SUBS=0"
set "LANGS=zh-Hans,zh-CN,zh,en"

rem For sites that require login, put a Netscape-format cookies.txt path here. Otherwise leave empty.
set "COOKIES_FILE="

rem Extra yt-dlp arguments (advanced). Leave empty normally.
set "EXTRA="
rem -------------------------------------------------------------------------

rem Environment variable can override the output folder.
if defined DL_OUT_DIR set "OUT_DIR=%DL_OUT_DIR%"

rem ------------------------------ ARGUMENTS --------------------------------
rem Use %* (whole command line) so a "=" inside the URL is not treated as an
rem argument separator by cmd (%1 alone would split watch?v=ID in two).
set "URL=%*"
if not "%URL%"=="" set "URL=%URL:"=%"

set "INTERACTIVE=0"
if "%URL%"=="" set "INTERACTIVE=1"

if /i "%URL%"=="-h" goto :usage
if /i "%URL%"=="/?" goto :usage
if /i "%URL%"=="--help" goto :usage

if "%URL%"=="" (
  echo Paste the video URL and press Enter ^(yt-dlp must support the site^):
  echo.
  set /p "URL="
  echo.
)

echo [config] yt-dlp    : %YTDLP%
echo [config] ffmpeg    : %FFMPEG%
echo [config] out dir   : %OUT_DIR%
echo [config] mode      : %MODE%
echo [config] subs/list : SUBS=%SUBS% / PLAYLIST=%PLAYLIST%
echo [config] url       : "%URL%"
echo.

rem ============================== 1) VALIDATE ==============================
echo [check] validating arguments and paths...

if "%URL%"=="" (
  echo [ERROR] No URL given.
  goto :fail
)

if not exist "%YTDLP%" (
  echo [ERROR] yt-dlp not found: %YTDLP%
  echo         Download the standalone build ^(no Python needed, ~17MB^):
  echo         https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe
  echo         Put it in tools\ or edit YTDLP in the SETTINGS block.
  goto :fail
)

set "MODE_OK=0"
if /i "%MODE%"=="video" set "MODE_OK=1"
if /i "%MODE%"=="audio" set "MODE_OK=1"
if "%MODE_OK%"=="0" (
  echo [ERROR] MODE must be video or audio. Current value: %MODE%
  goto :fail
)

if /i "%MODE%"=="video" if not exist "%FFMPEG%" (
  echo [ERROR] video mode needs ffmpeg to mux streams, but it was not found: %FFMPEG%
  echo         Fix FFMPEG in the SETTINGS block, or set MODE=audio.
  goto :fail
)

if not "%COOKIES_FILE%"=="" if not exist "%COOKIES_FILE%" (
  echo [ERROR] cookies file not found: %COOKIES_FILE%
  goto :fail
)

if not exist "%OUT_DIR%" mkdir "%OUT_DIR%"
if not exist "%OUT_DIR%" (
  echo [ERROR] Cannot create output folder: %OUT_DIR%
  goto :fail
)

echo [check] OK.
echo.

rem --------------------------- BUILD ARGUMENTS ---------------------------
set "OPT_FFMPEG="
if exist "%FFMPEG%" set "OPT_FFMPEG=--ffmpeg-location "%FFMPEG%""

set "OPT_MODE=-f "bv*+ba/b" --merge-output-format mp4"
if /i "%MODE%"=="audio" set "OPT_MODE=-f "bestaudio/best""

set "OPT_PLAYLIST=--no-playlist"
if "%PLAYLIST%"=="1" set "OPT_PLAYLIST="

set "OPT_SUBS="
if "%SUBS%"=="1" set "OPT_SUBS=--write-subs --write-auto-subs --sub-langs "%LANGS%" --sub-format vtt"

set "OPT_COOKIES="
if not "%COOKIES_FILE%"=="" set "OPT_COOKIES=--cookies "%COOKIES_FILE%""

for /f %%C in ('dir /b /a-d "%OUT_DIR%" 2^>nul ^| find /c /v ""') do set "FILES_BEFORE=%%C"

rem ======================= 2) PREFLIGHT: IS IT SUPPORTED? =======================
echo [step 1/2] Resolving URL ^(checking the site is supported, reading title^)...
call :ticks _t0
"%YTDLP%" --no-warnings --simulate --print "%%(title)s" "%URL%"
if errorlevel 1 (
  echo.
  echo [ERROR] Cannot resolve this URL. Common causes:
  echo         - site not supported by yt-dlp: check with "%YTDLP%" --list-extractors
  echo         - link requires login: set COOKIES_FILE in the SETTINGS block
  echo         - network blocked: make sure the proxy is on and covers this site
  echo         - HTTP 412 on a bilibili URL: that is caused by a VPN / global proxy
  echo           ^(bilibili blocks foreign IPs^). Turn the proxy off or route
  echo           bilibili.com direct. See NETWORK.md in the project root.
  echo         - yt-dlp too old: run "%YTDLP%" -U
  goto :fail
)
call :ticks _t1
echo [step 1/2] OK - URL is supported.
call :show_elapsed %_t0% %_t1%
echo.

rem ============================== 3) DOWNLOAD ==============================
echo [step 2/2] Downloading ^(live progress below^)...
echo            ------------------------------------------------------
call :ticks _t2
"%YTDLP%" --no-warnings --newline --windows-filenames --no-simulate --ffmpeg-location "%FFMPEG%" %OPT_MODE% %OPT_PLAYLIST% %OPT_SUBS% %OPT_COOKIES% %EXTRA% -o "%OUT_DIR%\%%(title).80s [%%(id)s].%%(ext)s" --print after_move:filepath "%URL%"
set "RC=%errorlevel%"
call :ticks _t3
echo            ------------------------------------------------------
if not "%RC%"=="0" (
  echo [ERROR] Download failed ^(yt-dlp exit code %RC%^).
  echo         If the site changed recently, run "%YTDLP%" -U and retry.
  goto :fail
)
call :show_elapsed %_t2% %_t3%
echo.

rem ============================== 4) SUMMARY ==============================
for /f %%C in ('dir /b /a-d "%OUT_DIR%" 2^>nul ^| find /c /v ""') do set "FILES_AFTER=%%C"

echo ============================================
echo   Done
echo ============================================
echo   Output folder : %OUT_DIR%
echo   File count    : %FILES_BEFORE% before, %FILES_AFTER% after

if "%FILES_BEFORE%"=="%FILES_AFTER%" (
  echo.
  echo   [note] File count did not increase. Possible reasons:
  echo          - this video was already downloaded; yt-dlp skipped it
  echo            ^(delete the old file and run again to force a re-download^)
  echo          - the URL points to a page or playlist, not a single video
)

if /i "%MODE%"=="audio" (
  echo.
  echo   [note] Audio kept its original container ^(not re-encoded^). You can feed it
  echo          straight into transcribe.bat to get text:
  echo          transcribe.bat "downloaded-audio-file" "output-text.txt"
)

if /i "%MODE%"=="video" echo.
if /i "%MODE%"=="video" echo   [note] yt-dlp already muxed the streams and cleaned up the temp parts.
echo.

if "%INTERACTIVE%"=="1" pause
exit /b 0

rem ============================== USAGE ==============================
:usage
echo Usage: download.bat "VIDEO_URL"
echo.
echo   - If the URL contains an ampersand ^(e.g. a list= parameter^), wrap the whole
echo     URL in double quotes:
echo     download.bat "https://www.youtube.com/watch?v=xxxxxxxxxxx"
echo   - Double-clicking is easiest: it prompts you to paste a link, no quoting needed.
echo   - Output folder, mode, subtitles etc. are set in the SETTINGS block of this file.
echo   - Temporary output folder override:  set DL_OUT_DIR=D:\somewhere
echo.
if "%INTERACTIVE%"=="1" pause
exit /b 0

rem ============================== EXIT ==============================
:fail
echo.
echo ============================================
echo   Failed - aborted
echo ============================================
echo   An interrupted download may leave .part files in the output folder.
echo   Just run this script again: yt-dlp resumes and will not re-download
echo   the parts that already completed.
echo.
if "%INTERACTIVE%"=="1" pause
exit /b 1

rem call :ticks VAR  -> store current time as centiseconds-since-midnight in VAR
:ticks
for /f "tokens=1-4 delims=:., " %%a in ("%TIME%") do set /a "%~1=(((1%%a-100)*60+(1%%b-100))*60+(1%%c-100))*100+(1%%d-100)"
goto :eof

rem call :show_elapsed START END -> print "took X.XX s"
:show_elapsed
set /a "_e=%~2-%~1"
if %_e% lss 0 set /a "_e+=8640000"
set /a "_s=_e/100"
set /a "_c=_e%%100"
if %_c% lss 10 set "_c=0%_c%"
echo           took %_s%.%_c% s
goto :eof
