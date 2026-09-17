# transcribe.bat 使用文档

> 位置：`<项目目录>\transcribe.bat`（BiliSummarize 项目的**独立**语音转文字工具，不依赖 Node 服务）
> 作用：把任意音频/视频里的语音转成纯文本 txt。全程本地，GPU 加速（Vulkan）。

---

## 1. 它做什么

两步流水线，和主项目 `server.js` 里跑的完全一样：

```
输入音频 ──► ① FFmpeg 转码 ──►  ② whisper-cli 识别 ──► 输出 txt
            16kHz/单声道/PCM16       Vulkan GPU（AMD 卡）
```

- ① 转码参数：`-ar 16000 -ac 1 -c:a pcm_s16le`（whisper 要求的格式，见 `server.js` 的 `ffmpegToWav`）
- ② 识别参数：`-m <模型> -f <wav> -l <语言> -t <线程> -otxt -of <前缀> --no-prints`（同 `lib/transcribe.js`）

**输出是纯文本**（`-otxt` 不带时间戳）；带时间戳的识别内容会实时滚动打印在控制台，方便看进度。

---

## 2. 快速开始

### 方式一：直接双击
双击 `transcribe.bat`，用脚本内置的默认参数：
输入 `tools\test.wav` → 输出 `tools\test.txt`。
（出错时会 `pause` 停在窗口，方便看提示。）

### 方式二：命令行带参
```bat
<项目目录>\transcribe.bat "D:\meeting.m4a" "D:\meeting.txt"
transcribe.bat "<项目目录>\tools\test.wav" "<项目目录>\tools\test.txt"
```
参数含空格务必加引号。带参调用结束直接返回，不 `pause`，适合被其它脚本串起来。

---

## 3. 参数

| 位置 | 含义 | 默认值（不传时） |
| --- | --- | --- |
| `%1` | 输入语音文件路径（wav / m4a / mp3 / mp4 等，靠 ffmpeg 解码） | `<项目目录>\tools\test.wav` |
| `%2` | 输出文本路径（`.txt`） | `<项目目录>\tools\test.txt` |

只传第一个参数时，输出仍走默认路径。输出目录不存在会**自动创建**。

---

## 4. 配置区（要改就改这里）

脚本顶部【配置区】集中了所有可调项，不用碰命令行：

| 变量 | 说明 | 默认值 |
| --- | --- | --- |
| `WHISPER_DIR` | whisper 项目目录 | `<项目目录>\tools\whisper-v1.8.4-windows-vulkan-x64` |
| `WHISPER_CLI` | whisper 可执行文件 | `%WHISPER_DIR%\whisper-cli.exe` |
| `WHISPER_MODEL` | 识别模型 | `<项目目录>\tools\ggml-large-v3-turbo.bin` |
| `FFMPEG` | ffmpeg 路径（不存在时自动回退 `where ffmpeg`） | `<项目目录>\tools\ffmpeg.exe` |
| `IN_AUDIO` | 默认输入 | `<项目目录>\tools\test.wav` |
| `OUT_TEXT` | 默认输出 | `<项目目录>\tools\test.txt` |
| `LANG` | 识别语种，`auto`=自动判别，中文可设 `zh` | `auto` |
| `THREADS` | CPU 线程数（GPU 推理时影响较小） | `8` |
| `TEMP_DIR` | 中间文件目录 | `%~dp0temp`（即项目 `temp\`） |
| `KEEP_TEMP` | `1`=成功后也保留中间文件；`0`=成功后删除 | `0` |

> `LANG` 为什么默认 `auto`：脚本内置的默认输入 `tools\test.wav` 是英文录音，写死 `zh` 会和默认输入自相矛盾。只跑中文语音时改成 `zh`（与 `config.json` 的 `defaultLang` 一致）。
> 这些路径与 `config.json` 的 `whisperCli` / `whisperModel` / `ffmpeg` 一一对应，换机器时两边一起核对。
> 表中路径均以**脚本所在目录**（`%~dp0`，即项目根目录）为基准，所以项目克隆到任意盘符/目录都能直接跑，不需要改脚本。

---

## 5. 中间临时文件与清理规则（重点）

**会删除。** 转码产物只是喂给 whisper 的中转件，识别完就没用了。

流程中会产生两个中间文件，都在 `temp\`（即 `TEMP_DIR`）下：

| 中间文件 | 内容 | 成功时 | 失败时 |
| --- | --- | --- | --- |
| `temp\<输入名>.16k.wav` | ① FFmpeg 转码产物（16kHz 单声道） | **自动删除** | **保留**，并在日志里打印完整路径 |
| `temp\<输入名>.whisper.txt` | ② whisper 写出的文本，被 `copy` 到输出路径前的中转件 | **自动删除** | **保留**，同上 |

规则细节：

1. **成功路径**：按 `KEEP_TEMP` 决定——
   - `KEEP_TEMP=0`（默认）：两个中间文件都删掉，日志打印
     `[清理] ✓ 已删除中间文件 test.16k.wav 与 test.whisper.txt`
   - `KEEP_TEMP=1`：都保留，日志列出路径（转码有问题时用它复听那段 wav）。
2. **失败路径**：**一律保留**，并在结束前打印
   `中间文件已保留，便于排查：` + 具体路径。
   留着是为了让你能直接检查「ffmpeg 到底产出了什么」。确认没用后手动删掉即可，`temp\` 下的文件随时可删。
3. 转码失败（输入不是有效音频）时 ffmpeg 根本没生成 wav，所以不会有残留，脚本会明确提示 `FFmpeg 未生成转码文件`。
4. 脚本**只**清理它自己这两个中间文件，不会碰 `temp\` 里主项目缓存的 `BV*.m4s` / `BV*.wav` / `*.transcript.txt`。

> 注意：主项目 `server.js` 跑流水线时用的是另一套命名（`temp\<bvid>_<cid>.wav`），且**不会**自动删（因为它要留给转写缓存复用）。两者互不干扰。

---

## 6. 退出码

| 退出码 | 含义 |
| --- | --- |
| `0` | 成功，输出文件已写入 |
| `1` | 失败（任意一步出错都会中止并返回 1） |

方便被其它脚本/批处理判断：
```bat
call transcribe.bat "%AUDIO%" "%TXT%"
if errorlevel 1 echo 转写失败，请查看上方日志
```

---

## 7. 执行日志样例

```
============================================
  BiliSummarize - 语音转文字
============================================

[配置] whisper-cli : <项目目录>\tools\whisper-v1.8.4-windows-vulkan-x64\whisper-cli.exe
[配置] 模型        : <项目目录>\tools\ggml-large-v3-turbo.bin
[配置] ffmpeg      : <项目目录>\tools\ffmpeg.exe
[配置] 输入语音    : <项目目录>\tools\test.wav
[配置] 输出文本    : <项目目录>\tools\test.txt
[配置] 语言 / 线程 : auto / 8

[检查] 正在校验路径合法性...
[检查] 通过：输入文件、whisper-cli、模型、ffmpeg 均已就绪。

[步骤 1/2] FFmpeg 转码为 whisper 支持的格式（16000 Hz / 单声道 / PCM 16bit）
           输入：<项目目录>\tools\test.wav
           输出：<项目目录>\temp\test.16k.wav
[步骤 1/2] ✓ 转码完成。
           耗时 0.15 秒

[步骤 2/2] whisper 语音识别中（Vulkan GPU，约 60 倍实时）...
           模型：<项目目录>\tools\ggml-large-v3-turbo.bin
           ------------------------------------------------------
[00:00:00.000 --> 00:00:08.980]   ...识别内容实时滚动...
[00:13:21.840 --> 00:13:21.840]   ...
           ------------------------------------------------------
[步骤 2/2] ✓ 识别完成。
           耗时 13.85 秒

[输出] 正在写入文本：<项目目录>\tools\test.txt
[输出] ✓ 已写入，大小 10738 字节。

[清理] 正在处理中间临时文件...
[清理] ✓ 已删除中间文件 test.16k.wav 与 test.whisper.txt

============================================
  全部完成
============================================
  文本输出：<项目目录>\tools\test.txt
```

---

## 8. 常见问题

| 现象 | 原因 / 处理 |
| --- | --- |
| `[错误] 未找到 whisper-cli / 模型` | `tools\` 没就位。whisper 构建与模型体积大、不入 git，需按 `README.md` 的「环境要求」自备 |
| `[错误] 未找到 ffmpeg` | 改【配置区】`FFMPEG`，或把 ffmpeg 加入 PATH |
| `[错误] FFmpeg 未生成转码文件` | 输入不是有效音频/文件损坏。先用 `ffmpeg -i "文件"` 单独试跑看报错 |
| `[错误] whisper 识别失败` 且提示显存不足 | 12GB 显存跑 large-v3-turbo 通常够；若同时开着 LM Studio 占显存，先卸载模型再跑 |
| 中文识别成英文/乱码 | `LANG` 设成 `zh`（默认 `auto` 自动判别） |
| 输出文件写入失败 | 目标 txt 正被编辑器占用，或目录无写权限 |
| **控制台中文乱码 / 一堆 `'xxx' is not recognized`** | 脚本被改坏了行尾。`.bat` 必须 **CRLF 行尾 + UTF-8 无 BOM**，否则 cmd 会按字节错位解析（见下节） |

---

## 9. 实测性能（用户机器：AMD RX 9070 GRE / 16 线程）

| 环节 | 数据 |
| --- | --- |
| FFmpeg 转码 | 0.15～0.31 秒（807 秒音频） |
| whisper 识别 | 13.9～14.6 秒（807 秒音频，**约 55 倍实时**） |
| 输出 | 约 10.7 KB 纯文本 |
| GPU | Vulkan0 正确命中 `AMD Radeon RX 9070 GRE` |

---

## 10. 维护提示

- **改路径/模型/语言**：只改脚本顶部【配置区】，不要散落到命令行里（配置集中在脚本顶部，便于换机器）。
- **保持编码**：本文件是 UTF-8 无 BOM，`.bat` 要求 **CRLF 行尾**。用 VS Code 等编辑器改完注意别存成 LF，否则 cmd 会把半行当命令执行、报出莫名其妙的错误（这个坑实际踩过）。脚本第 2 行 `chcp 65001` 负责让中文正常显示，别删。
- **`:ticks` / `:show_elapsed`** 两个子过程负责算耗时；`:ticks` 里用 `1%%a-100` 是为了绕开 `set /a` 把 `08`、`09` 当八进制报错的问题，别改。
- 本脚本与 `server.js` 的流水线是**两条独立路径**：改转码/识别参数时建议两边同步，避免行为不一致。
