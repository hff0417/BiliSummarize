# download.bat 使用文档

> 位置：`<项目目录>\download.bat`（BiliSummarize 附带的**通用下载小工具**，基于 yt-dlp）
> 一句话：把链接丢给它，视频/音频就下到本地。yt-dlp 官方支持 **1800+ 站点**（YouTube、B 站、Vimeo、各类公开课站点等）。

---

## 1. 前提

| 依赖 | 说明 |
| --- | --- |
| `tools\yt-dlp.exe` | 必需。官方独立版（免 Python、约 17MB），未装时脚本会给出下载地址 |
| `ffmpeg` | **仅 video 模式需要**（合并音视频）；audio 模式不装也能跑 |

> ⚠️ **请只下载你有权下载的内容**——自己的作品、已授权平台、CC 授权或公共领域素材。下载受版权保护的作品可能构成侵权，脚本不替你判断来源合法性。

---

## 2. 快速开始

**方式一：直接双击（最省事）**
双击 `download.bat`，按提示粘贴链接回车即可。**这种方式完全不用管引号问题。**

**方式二：命令行**
```bat
download.bat "https://www.bilibili.com/video/BV1xxxxxxxxx"
download.bat "https://www.youtube.com/watch?v=xxxxxxxxxxx"
```

> 📌 **本脚本的日志是英文的**——这是刻意为之，原因见 §10（`.bat` 里写中文正文会导致 cmd 解析错乱）。配置项、用法和英文日志的对照见下文的表格。

---

## 3. 引号规则（重要）

| 链接里含 | 要不要加引号 | 说明 |
| --- | --- | --- |
| 只有 `?v=xxx` 这类 `=` | **可以不加** | 脚本用 `%*` 取整条命令行，不会被 `=` 拆开 |
| 含 `&`（如 `?v=xxx&list=yyy`） | **必须加引号** | 不加的话 `&` 会被 cmd 当成命令分隔符，链接从 `&` 处断掉 |

```bat
:: 正确
download.bat "https://www.youtube.com/watch?v=xxxx&list=yyyy"

:: 错误：& 没加引号，链接会被截断
download.bat https://www.youtube.com/watch?v=xxxx&list=yyyy
```

懒得管引号就**双击运行**，粘贴链接最稳。

---

## 4. 配置区（改这里就够）

脚本顶部 `SETTINGS` 段集中了所有可调项：

| 变量 | 说明 | 默认值 |
| --- | --- | --- |
| `YTDLP` | yt-dlp 路径 | `<项目目录>\tools\yt-dlp.exe` |
| `FFMPEG` | ffmpeg 路径 | `<项目目录>\tools\ffmpeg.exe` |
| `OUT_DIR` | 输出目录 | `<项目目录>\downloads`（已在 `.gitignore` 排除） |
| `MODE` | 下载模式，见下节 | `video` |
| `PLAYLIST` | `1`=允许下整个播放列表；`0`=只下单个视频 | `0` |
| `SUBS` | `1`=同时下载字幕（人工优先，无则自动），vtt 格式 | `0` |
| `LANGS` | 字幕语言优先级 | `zh-Hans,zh-CN,zh,en` |
| `COOKIES_FILE` | 需登录的站点填 cookies.txt 路径（Netscape 格式） | 空 |
| `EXTRA` | 追加自定义 yt-dlp 参数（高级用法） | 空 |

> 表中路径以**脚本所在目录**（`%~dp0`，即项目根目录）为基准，项目克隆到任意位置都能直接用，不必改脚本里的路径。

**临时改输出目录**（不改脚本）：
```bat
set DL_OUT_DIR=D:\somewhere
download.bat "链接"
```

---

## 5. 两种模式

| 模式 | 取流参数 | 产出 | 用途 |
| --- | --- | --- | --- |
| `video`（默认） | `bv*+ba/b` + `--merge-output-format mp4` | 单个 `.mp4`（已合并音视频） | 收藏、留档 |
| `audio` | `bestaudio/best` | `.webm` / `.m4a` 等**原始容器，不转码** | 喂给转写工具 |

> audio 模式刻意**不做转码**：避免二次有损压缩。要转 16k 单声道 wav 交给 `transcribe.bat`，它内部会用 ffmpeg 转好。

---

## 6. 和其它工具串起来用

```bat
:: 1) 下载音频（先把 MODE 改成 audio）
download.bat "链接"

:: 2) 音频 → 文字（自动转 16k wav 再走 whisper GPU）
transcribe.bat "<项目目录>\downloads\xxx.webm" "<项目目录>\downloads\xxx.txt"
```

而**总结**（要点/关键词/追问）请用项目本体：粘贴链接到 http://localhost:3000。

---

## 7. 输出文件命名

规则：`<标题前80字> [<视频ID>].<扩展名>`，例如：

```
Me at the zoo [jNQXAC9IVRw].mp4
Me at the zoo [jNQXAC9IVRw].en.vtt      ← SUBS=1 时的字幕
```

- 开了 `--windows-filenames`，标题里的非法字符会被自动替换，中文标题不受影响。
- 同名文件已存在时 yt-dlp **会跳过**，此时摘要会提示 "File count did not increase"。

---

## 8. 退出码与日志对照

| 退出码 | 含义 |
| --- | --- |
| `0` | 成功（含"已下载过、跳过"） |
| `1` | 失败（未找到 yt-dlp / 链接无法解析 / 下载出错） |

日志前缀含义：

| 前缀 | 阶段 |
| --- | --- |
| `[config]` | 回显本次使用的参数 |
| `[check]` | 参数与路径校验（yt-dlp / ffmpeg / 模式 / cookies / 输出目录） |
| `[step 1/2]` | 预检：解析链接、确认站点受支持、读出标题 |
| `[step 2/2]` | 正式下载（实时进度） |
| `[note]` | 提示（文件数没增加、audio 模式可交给 transcribe 等） |
| `[ERROR]` | 出错（随后进入 `Failed - aborted`） |

---

## 9. 常见问题

| 现象 | 处理 |
| --- | --- |
| `yt-dlp not found` | 下载 [官方独立版](https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe) 放入 `tools\`，或改 `YTDLP` |
| `Cannot resolve this URL` | 站点可能不支持 / 需要登录 / 网络不通 / yt-dlp 太旧（见下） |
| **B 站报 HTTP 412** | 你**开着 VPN / 全局代理**。B 站限制境外 IP——关掉代理，或让 `bilibili.com` 走直连。**详见 [NETWORK.md](NETWORK.md)** |
| 报 403 / 429 / 取流失败 | 先 `tools\yt-dlp.exe -U` 升级（站点改版会让旧版失效） |
| 需要登录的站点（会员内容等） | 用浏览器扩展导出 `cookies.txt`，填到 `COOKIES_FILE` |
| 下到一半断了 | 重新运行即可**续传**，不会重复下载已完成部分（`.part` 文件会保留） |
| `File count did not increase` | 该视频之前已下过，yt-dlp 跳过了；删掉旧文件再下 |
| 日志是英文 | 刻意为之，见 §10 |

---

## 10. 维护提示（改脚本前必看）

### 10.1 本文件必须保持「纯 ASCII」

**这是硬约束，不是风格偏好。** 实测踩过：

- cmd 读取 `.bat` 时，用的是**读取那一刻的控制台代码页**。文件若是 UTF-8 且含中文，一旦中途 `chcp 65001`，cmd 的多字节解码会**字节偏移失步**：
  - 表现为从**行中间**开始执行碎片 —— 报 `'载到本地。yt-dlp' is not recognized as an internal or external command`；
  - 严重时会**反复重读同一段** —— 报 `Maximum setlocal recursion level reached`（脚本里其实只有一个 `setlocal`）。
- 这个问题**只在默认 CP936 的新控制台（即双击）复现**；如果终端已经是 65001（例如先设过 UTF-8），反而看不到。
- 试过「先切代码页再自我调用一次」的两段式引导 —— **无效**，因为首块内容在 `chcp` 生效前就已被按旧代码页解码。
- 结论：**保持纯 ASCII，任何代码页下解码结果一致，这类故障才彻底不可能发生。** 中文说明放在本文件（`.md`），不要挪回 `.bat`。

> 附带发现：`transcribe.bat`（UTF-8 + 中文正文 + `chcp`）在 CP936 下**同样会**冒出 2 条碎片报错，只是碰巧没被注意到。修法同上（改为纯 ASCII 日志）。

### 10.2 其他已踩过的坑

- **必须 CRLF 行尾**，且不要加 BOM。
- **链接用 `%*` 取，不要改回 `%1`**：cmd 会把 `=`、`,`、`;` 当参数分隔符，用 `%1` 时 `watch?v=xxx` 会被切成 `watch?v` 和 `xxx` 两段。
- **`echo` 里不要写裸的 `>` `<` `|` `&`**：会被当成重定向/管道。曾因 `echo count: 0 -> 1` 把输出重定向进一个名为 `1` 的文件、并让那一行整个消失。需要箭头用文字表达。
- **括号要转义**：`echo` 里出现 `(` `)` 时写成 `^(` `^)`，尤其在 `if (...)` 块内部（不转义会提前结束代码块）。
- `:ticks` / `:show_elapsed` 负责计时；`1%%a-100` 是为绕开 `set /a` 把 `08`/`09` 当八进制报错，别改。
