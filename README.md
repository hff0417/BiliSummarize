# 🎬 BiliSummarize — 本地视频要点总结（B 站 / YouTube）

粘贴 **B 站**或 **YouTube** 视频链接，自动生成**核心概述 / 内容要点 / 关键名词 / 结语**，还能就视频内容自由追问（支持多轮对话）。
全程本地运行：语音转写走 **whisper-large-v3-turbo（Vulkan GPU 加速）**，总结走 **LM Studio 本地 Qwen3.6**，视频内容不会被上传到任何第三方 AI 服务、无需 API key、不限量。

---

## 一、快速开始（三步跑起来）

### 准备
0. **获取项目**：`git clone` 本项目到本地（或下载 ZIP 解压），以下操作均在项目目录内进行
1. 已安装 **Node.js ≥ 18**
2. **LM Studio** 已安装并启动
3. whisper / 模型 / ffmpeg / yt-dlp 需自行准备（仓库不含大文件，见下方「环境要求」下载指引）
4. 复制 `config.example.json` 为 `config.json`，按本机实际路径修改（至少 ffmpeg 路径）

目录结构预览（要把依赖放进对应位置）：

```text
BiliSummarize/
├── server.js           主服务（node server.js / start.bat）
├── config.example.json 配置模板 → 复制为 config.json 修改
├── lib/providers/      平台适配层（bilibili / youtube，加新平台只需新增一个文件）
├── public/             前端页面（原生 HTML/JS，无需构建，直接用）
├── tools/              需自备：whisper-cli（Vulkan 版）+ ggml-large-v3-turbo.bin + yt-dlp.exe
├── transcribe.bat      独立语音转文字小工具（详见 transcribe.md）
├── download.bat        通用视频/音频下载小工具（详见 download.md）
├── NETWORK.md          网络与代理说明（想同时用 B 站 + YouTube 必看）
└── temp/               运行缓存（音频/转写文本，自动生成）
```

### 第 1 步：启动本地大模型

打开 **LM Studio** → 左侧加载模型，选择 `qwen/qwen3.6-35b-a3b`（或其他本地模型），点加载。

> 💡 若模型未下载，在 LM Studio 搜索框输入 `qwen3.6-35b-a3b` 可从 HuggingFace 拉取（12GB 显存建议选 Q4_K 量化版）。

> ⚠️ **重要**：在 LM Studio 里关闭模型的思考开关——路径：**「终端（Terminal）→ Inference → 自定义字段（Custom Fields）→ Enable Thinking」**，关闭后**重新加载模型**才生效。不关的话，35B 模型的思考链可达数万 token，一次总结要好几分钟。

### 第 2 步：启动本服务

**方式 A（推荐）**：双击项目根目录的 `start.bat` —— 它会自动启动服务并打开浏览器。

**方式 B（手动）**：在项目目录打开终端，运行：

```bash
node server.js
```

看到如下输出即启动成功：

```
🎬  BiliSummarize 已启动
  打开页面:  http://localhost:3000
  转写引擎:  whisper-cli (Vulkan GPU) ✅
  转写模型:  whisper-large-v3-turbo ✅
  ffmpeg:    已就绪 ✅
  yt-dlp:    已就绪 ✅（YouTube 取流）
  支持平台:  B 站 / YouTube
  总结模型:  qwen/qwen3.6-35b-a3b（LM Studio localhost:1234）
```

### 第 3 步：在浏览器中使用

在 **Edge / Chrome** 打开 **http://localhost:3000**（`start.bat` 会自动打开）：
1. 粘贴视频链接，支持：
   - **B 站**：`https://www.bilibili.com/video/BV1xxxxxx`、`b23.tv` 短链，或直接填 BV 号
   - **YouTube**：`https://www.youtube.com/watch?v=xxxxxxxxxxx`、`youtu.be/xxxxxxxxxxx`、`shorts` 链接
2. 选择识别语言（B 站默认中文；YouTube 建议选「自动检测」）
3. 页面实时显示 5 步进度：获取信息 → 字幕/音频 → GPU 语音识别 → AI 总结 → 完成
4. 得到结构化总结后，可「复制全文」或「复制 Markdown」
5. 在底部**追问区**就视频内容自由提问（可多轮、可发散）

---

## 二、环境要求

> 本项目目前面向 **Windows** 开发（`start.bat`、whisper Vulkan 构建均为 Windows 形态）。

| 组件 | 说明 |
| --- | --- |
| Node.js ≥ 18 | 运行后端服务 |
| whisper-cli（Vulkan 版）| 官方 whisper.cpp release 只带 CPU/CUDA 版，本项目用的 **Vulkan 社区预编译**：[whisper-v1.8.4-windows-vulkan-x64.zip](https://github.com/lemonade-sdk/whisper.cpp-rocm/releases/download/v1.8.4/whisper-v1.8.4-windows-vulkan-x64.zip)，解压后放入 `tools/`，A/N 卡均可 GPU 加速 |
| ggml-large-v3-turbo.bin | 转写模型（约 1.6GB），自 [HuggingFace · ggerganov/whisper.cpp · ggml-large-v3-turbo.bin](https://huggingface.co/ggerganov/whisper.cpp/blob/main/ggml-large-v3-turbo.bin) 下载，放入 `tools/` |
| ffmpeg | 音频转 16kHz wav。把 `ffmpeg.exe` 放进 `tools/`（示例配置的默认值），或把绝对路径写入 `config.json` 的 `ffmpeg` 字段；Windows 可 `winget install ffmpeg` 或用官网全量包 |
| yt-dlp | **仅 YouTube 需要**。取 YouTube 的元信息/字幕/音频。下载 [官方独立版 yt-dlp.exe](https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe)（约 17MB，**免 Python**）放入 `tools/`；失效时用 `yt-dlp -U` 自更新 |
| LM Studio | 运行本地大模型（qwen3.6-35b-a3b 等），需已启动并加载模型 |

> `tools/` 体积大（whisper 构建 + 1.6GB 模型，合计约 1.7GB），**未纳入 git 仓库**。克隆后请把 whisper-cli 与模型放回 `tools/`（ffmpeg 也建议放这里，与示例配置一致），并复制 `config.example.json` 为 `config.json` 修改本机路径。
>
> 附带的两个小工具 `transcribe.bat` / `download.bat` 已改为**相对脚本自身目录**定位依赖（`%~dp0tools\...`），因此项目克隆到任何盘符/目录都能直接用，不再需要改脚本里的路径。
>
> 🌐 **关于 YouTube**：抓取 YouTube 需要能访问该站点（中国大陆通常需自备代理），且 yt-dlp 会随 YouTube 改版而失效，取流失败先 `yt-dlp -U` 升级再试。
>
> ⚠️ **B 站与 YouTube 的出口 IP 要求正好相反**（B 站会拒绝境外 / 代理 IP，而 YouTube 又必须走代理），所以**开着全局代理会导致 B 站报 412**。想同时使用两个平台，请把代理设为「规则模式」分流——完整域名清单与配置方法见 **[NETWORK.md](NETWORK.md)**。

## 三、功能特性

- 一键总结：输入链接即得**核心概述 / 内容要点 / 关键名词 / 结语**，要点按时长自动增删、每条含具体细节（型号/数字/价格/对比）
- **多平台**：支持 **B 站**与 **YouTube**，按链接域名自动识别；新增平台只需在 `lib/providers/` 加一个文件，前后端无需改动
- 本地推理：语音转写（whisper GPU）与 AI 总结（本地 Qwen）全部在本机完成，视频内容不会被上传到任何第三方 AI 服务
- 阶段耗时：完成后显示「字幕 / 下载 / 转换 / GPU 识别 / 本地总结 / 总计」各环节耗时
- 追问对话：总结完成后可直接向本地 Qwen 追问（流式实时回答），**支持多轮对话**——模型会记住之前的问答，并结合视频内容与自身知识自由作答
- 转写缓存：同一视频重复总结自动跳过语音识别（约省一半时间）
- 官方字幕快路径：有字幕的视频直接使用字幕，无需语音识别
  - B 站：官方 / AI 字幕
  - YouTube：人工字幕优先（中文 > 原语言 > 英文），其次自动字幕（原语言 > 英文 > 中文——中文自动字幕多为机翻，质量通常不如原语言）；没有字幕才走 GPU 转写

## 四、耗时参考（RX 9070 GRE + qwen3.6-35b-a3b）

| 环节 | 首次 | 缓存命中 |
| --- | --- | --- |
| 下载音频 + 转换 | ~2 秒 | - |
| GPU 语音转写（14 分钟视频） | ~20 秒 | - |
| 本地大模型总结 | ~20 秒 | ~20 秒 |
| **合计** | **~40 秒** | **~20 秒** |

**YouTube**（实测于 19 秒短片，字幕快路径）：取字幕 ~7 秒 + 本地总结 ~12-14 秒，**合计 ~25 秒**；无字幕时改走音频链路，实测 yt-dlp 下载 ~7 秒 + 转码 0.1 秒 + GPU 转写 2.5 秒（19 秒音频）。长视频主要耗时仍是 GPU 转写与本地总结，与 B 站一致。

## 五、配置（config.json）

仓库内置 `config.example.json`（示例配置）；本机 `config.json` 被 `.gitignore` 忽略、不入仓库，未存在时服务自动回退读取示例配置。请复制示例为 `config.json` 后按本机情况修改。

| 字段 | 说明 |
| --- | --- |
| `port` | 服务端口，默认 3000 |
| `whisperCli` / `whisperModel` | whisper 可执行文件与模型路径 |
| `ffmpeg` | ffmpeg 可执行文件路径 |
| `ytDlp` | yt-dlp 可执行文件路径（仅 YouTube 用，默认 `tools/yt-dlp.exe`） |
| `lmStudioUrl` / `lmStudioModel` | 本地大模型地址与模型名 |
| `whisperThreads` | 转写线程数 |
| `withTimestamps` | 转写是否带时间戳（默认 true，便于总结引用时间点） |
| `defaultLang` | 默认识别语言（zh / en / auto） |

## 六、工作原理

```
Edge 页面 ──> Node 后端 (localhost:3000)
                │  按链接域名路由到 lib/providers/ 的对应平台
                ├─ ① 平台信息接口 → 标题/封面/作者/时长（B 站：官方 API；YouTube：yt-dlp）
                ├─ ② 官方字幕？有→直接当文本（快路径）
                │    无↓
                ├─ ③ 下载音频 → ffmpeg 转 16kHz wav
                │     B 站：DASH 直链；YouTube：yt-dlp bestaudio
                ├─ ④ whisper-cli（Vulkan GPU）→ 转写文本
                └─ ⑤ 本地 Qwen3.6（LM Studio）→ 结构化总结 / 多轮问答
```

## 七、常见问题

- **页面提示「本地模型未连接」**：启动 LM Studio 并加载模型后再试。
- **总结很慢 / 一直转圈**：多半是没关 LM Studio 的「思考模式」，见「快速开始」第 1 步。
- **转写失败**：确认 `config.json` 里 whisper/模型路径正确，显卡驱动支持 Vulkan。
- **改端口**：修改 `config.json` 的 `port`。
- **追问提示「任务已过期」**：总结任务在服务端保留 60 分钟，超时需重新总结后再提问。
- **【最常见】B 站报「接口返回了非 JSON 内容（HTTP 412）」**：说明你的**出口 IP 在境外**——最常见就是**开着 VPN / 全局代理**。B 站会限制境外 IP，而 YouTube 又必须走代理，两者要求正好相反：**请把代理切成「规则模式」，让 B 站域名走直连**，即可同时使用两个平台；临时办法是总结 B 站时先关掉代理。**完整域名清单与配置方法见 [NETWORK.md](NETWORK.md)**。
- **提示「暂不支持该链接」**：目前仅支持 B 站与 YouTube；请确认粘贴的是视频页链接（不是专栏、动态或纯播放列表）。
- **YouTube 报「未找到 yt-dlp」**：把 `yt-dlp.exe` 放进 `tools/`，或改 `config.json` 的 `ytDlp` 路径。
- **YouTube 取流失败 / 报 403、429 等**：先执行 `tools\yt-dlp.exe -U` 升级（YouTube 改版会导致旧版失效）；另确认代理已开且覆盖 `googlevideo.com`；部分视频本身有区域/年龄限制，yt-dlp 会给出具体原因。
- **视频能打开但总结失败 / 封面裂图**：多半是分流的域名不全，见 [NETWORK.md](NETWORK.md) §2.1 的完整清单。

## 八、许可证

[MIT License](LICENSE)，Copyright (c) 2026 Altria Pendragon。
