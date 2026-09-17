@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title BiliSummarize - 语音转文字

rem ==========================================================================
rem  BiliSummarize - 语音转文字（独立批处理）
rem  作用：FFmpeg 转码为 whisper 可用格式 → whisper-cli(Vulkan GPU) 转写为文本
rem  用法：transcribe.bat [输入语音文件] [输出文本路径]
rem        两个参数都省略时，使用下方【配置区】里的默认测试音频
rem  约定：路径/模型/语言全部集中在【配置区】修改，不散落到命令行里
rem        （对应 config.json 的 whisperCli / whisperModel / ffmpeg）
rem ==========================================================================

echo ============================================
echo   BiliSummarize - 语音转文字
echo ============================================
echo.

rem -------------------------------- 配置区 ---------------------------------
rem 固定路径（相对脚本所在目录；换机器时核对这里）
set "WHISPER_DIR=%~dp0tools\whisper-v1.8.4-windows-vulkan-x64"
set "WHISPER_CLI=%WHISPER_DIR%\whisper-cli.exe"
set "WHISPER_MODEL=%~dp0tools\ggml-large-v3-turbo.bin"
set "FFMPEG=%~dp0tools\ffmpeg.exe"

rem 默认路径参数（命令行未传参时生效）
set "IN_AUDIO=%~dp0tools\test.wav"
set "OUT_TEXT=%~dp0tools\test.txt"

rem 转写参数：LANG 默认 auto 自动识别语种（通用场景更稳）；
rem          若只跑中文语音，可改成 zh（与 config.json 的 defaultLang 一致）
set "LANG=auto"
set "THREADS=8"

rem 中间临时文件目录；KEEP_TEMP=1 时保留转码后的 wav 便于排查
set "TEMP_DIR=%~dp0temp"
set "KEEP_TEMP=0"
rem -------------------------------------------------------------------------

rem ----------------------------- 命令行参数覆盖 -----------------------------
if not "%~1"=="" set "IN_AUDIO=%~1"
if not "%~2"=="" set "OUT_TEXT=%~2"

rem 无参数（双击）运行时出错后暂停，便于查看提示；带参调用则直接返回错误码
set "INTERACTIVE=0"
if "%~1"=="" set "INTERACTIVE=1"

echo [配置] whisper-cli : %WHISPER_CLI%
echo [配置] 模型        : %WHISPER_MODEL%
echo [配置] ffmpeg      : %FFMPEG%
echo [配置] 输入语音    : %IN_AUDIO%
echo [配置] 输出文本    : %OUT_TEXT%
echo [配置] 语言 / 线程 : %LANG% / %THREADS%
echo.

rem ========================= 一、路径合法性检查 =========================
echo [检查] 正在校验路径合法性...

if not exist "%IN_AUDIO%" (
  echo [错误] 输入语音文件不存在：%IN_AUDIO%
  goto :fail
)
if not exist "%WHISPER_CLI%" (
  echo [错误] 未找到 whisper-cli：%WHISPER_CLI%
  echo        请确认 tools\whisper-v1.8.4-windows-vulkan-x64 已就位。
  goto :fail
)
if not exist "%WHISPER_MODEL%" (
  echo [错误] 未找到 whisper 模型：%WHISPER_MODEL%
  echo        请按 README 自备 ggml-large-v3-turbo.bin 并放入 tools\。
  goto :fail
)

rem ffmpeg：优先用配置路径，缺失时回退到 PATH 中的 ffmpeg
if not exist "%FFMPEG%" (
  for /f "delims=" %%P in ('where ffmpeg 2^>nul') do set "FFMPEG=%%P"
)
if not exist "%FFMPEG%" (
  echo [错误] 未找到 ffmpeg：%FFMPEG%
  echo        请核对路径，或把 ffmpeg 加入 PATH。
  goto :fail
)

rem 准备临时目录与输出目录（输出目录可能还不存在）
if not exist "%TEMP_DIR%" mkdir "%TEMP_DIR%"
for %%D in ("%OUT_TEXT%") do if not exist "%%~dpD" mkdir "%%~dpD"

echo [检查] 通过：输入文件、whisper-cli、模型、ffmpeg 均已就绪。
echo.

rem ---------------------- 准备中间临时文件路径 ----------------------
for %%F in ("%IN_AUDIO%") do set "BASE=%%~nF"
set "TMP_WAV=%TEMP_DIR%\%BASE%.16k.wav"
set "TMP_OUTBASE=%TEMP_DIR%\%BASE%.whisper"
set "TMP_TXT=%TMP_OUTBASE%.txt"

rem ===================== 二、步骤 1/2：FFmpeg 转码 =====================
echo [步骤 1/2] FFmpeg 转码为 whisper 支持的格式（16000 Hz / 单声道 / PCM 16bit）
echo            输入：%IN_AUDIO%
echo            输出：%TMP_WAV%
call :ticks _t0
"%FFMPEG%" -y -loglevel error -i "%IN_AUDIO%" -ar 16000 -ac 1 -c:a pcm_s16le "%TMP_WAV%"
set "FFRC=%errorlevel%"
call :ticks _t1
rem 先判断产物是否存在/为空，再看退出码，报错信息更贴近真实原因
if not exist "%TMP_WAV%" (
  echo [错误] FFmpeg 未生成转码文件，转码失败。
  echo        请确认输入是有效音频（可先用 ffmpeg -i "%IN_AUDIO%" 单独试跑）。
  goto :fail
)
for %%F in ("%TMP_WAV%") do set "WAV_SIZE=%%~zF"
if "%WAV_SIZE%"=="0" (
  echo [错误] FFmpeg 生成的 wav 为 0 字节，输入可能不含有效音轨。
  goto :fail
)
if not "%FFRC%"=="0" (
  echo [错误] FFmpeg 转码异常（exit %FFRC%）。
  goto :fail
)
echo [步骤 1/2] ✓ 转码完成。
call :show_elapsed %_t0% %_t1%
echo.

rem =================== 三、步骤 2/2：whisper 语音转写 ===================
echo [步骤 2/2] whisper 语音识别中（Vulkan GPU，约 60 倍实时）...
echo            模型：%WHISPER_MODEL%
echo            说明：下方滚动内容为带时间戳的识别结果，最终以纯文本写入输出路径。
echo            ------------------------------------------------------
call :ticks _t2
rem --no-prints：抑制模型加载/参数等噪声输出，只保留带时间戳的识别结果
"%WHISPER_CLI%" -m "%WHISPER_MODEL%" -f "%TMP_WAV%" -l %LANG% -t %THREADS% -otxt -of "%TMP_OUTBASE%" --no-prints
set "RC=%errorlevel%"
call :ticks _t3
echo            ------------------------------------------------------
if not "%RC%"=="0" (
  echo [错误] whisper 识别失败（exit %RC%）。
  echo        若提示显存不足，可改用更小的模型，或检查 Vulkan 驱动。
  goto :fail
)
if not exist "%TMP_TXT%" (
  echo [错误] whisper 未生成转写文本（音频中可能没有人声）。
  goto :fail
)
echo [步骤 2/2] ✓ 识别完成。
call :show_elapsed %_t2% %_t3%
echo.

rem ========================== 四、写出结果文本 ==========================
echo [输出] 正在写入文本：%OUT_TEXT%
copy /y "%TMP_TXT%" "%OUT_TEXT%" >nul
if errorlevel 1 (
  echo [错误] 写入输出文本失败（目标文件可能被占用或无写权限）。
  goto :fail
)
for %%F in ("%OUT_TEXT%") do set "OUT_SIZE=%%~zF"
echo [输出] ✓ 已写入，大小 %OUT_SIZE% 字节。
echo.

rem ========================== 五、清理中间文件 ==========================
echo [清理] 正在处理中间临时文件...
if "%KEEP_TEMP%"=="1" (
  echo [清理] KEEP_TEMP=1，已保留：
  echo        %TMP_WAV%
  echo        %TMP_TXT%
) else (
  if exist "%TMP_WAV%" del /f /q "%TMP_WAV%" >nul
  if exist "%TMP_TXT%" del /f /q "%TMP_TXT%" >nul
  echo [清理] ✓ 已删除中间文件 %BASE%.16k.wav 与 %BASE%.whisper.txt
)
echo.

echo ============================================
echo   全部完成
echo ============================================
echo   文本输出：%OUT_TEXT%
echo.
if "%INTERACTIVE%"=="1" pause
exit /b 0

rem ============================ 子过程 / 出口 ============================
:fail
echo.
echo ============================================
echo   处理失败，已中止
echo ============================================
rem 失败时一律保留中间文件便于排查（成功时才按 KEEP_TEMP 决定是否删除）
set "LEFT="
if not "%TMP_WAV%"=="" if exist "%TMP_WAV%" set "LEFT=1"
if not "%TMP_TXT%"=="" if exist "%TMP_TXT%" set "LEFT=1"
if "%LEFT%"=="1" (
  echo   中间文件已保留，便于排查：
  if not "%TMP_WAV%"=="" if exist "%TMP_WAV%" echo    %TMP_WAV%
  if not "%TMP_TXT%"=="" if exist "%TMP_TXT%" echo    %TMP_TXT%
  echo   排查完可自行删除；下次成功运行后也会自动清掉。
)
echo.
if "%INTERACTIVE%"=="1" pause
exit /b 1

rem 用法：call :ticks 变量名 —— 把当前时间换算为“当日厘秒数”写入该变量
:ticks
for /f "tokens=1-4 delims=:., " %%a in ("%TIME%") do set /a "%~1=(((1%%a-100)*60+(1%%b-100))*60+(1%%c-100))*100+(1%%d-100)"
goto :eof

rem 用法：call :show_elapsed 起始厘秒 结束厘秒 —— 输出“耗时 X.XX 秒”
:show_elapsed
set /a "_e=%~2-%~1"
if %_e% lss 0 set /a "_e+=8640000"
set /a "_s=_e/100"
set /a "_c=_e%%100"
if %_c% lss 10 set "_c=0%_c%"
echo            耗时 %_s%.%_c% 秒
goto :eof
