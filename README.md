# 🎬 BiliSummarize — 本地 B 站视频要点总结

粘贴 B 站视频链接，自动生成**核心概述 / 内容要点 / 关键名词 / 结语**，还能就视频内容自由追问（支持多轮对话）。
全程本地运行：语音转写走 **whisper-large-v3-turbo（Vulkan GPU 加速）**，总结走 **LM Studio 本地 Qwen3.6**，视频内容不出本机、无需 API key、不限量。

---

## 一、快速开始（三步跑起来）

### 准备
0. **获取项目**：`git clone` 本项目到本地（或下载 ZIP 解压），以下操作均在项目目录内进行
1. 已安装 **Node.js ≥ 18**
2. **LM Studio** 已安装并启动
3. whisper / 模型 / ffmpeg 需自行准备（仓库不含大文件，见下方「环境要求」下载指引）
4. 复制 `config.example.json` 为 `config.json`，按本机实际路径修改（至少 ffmpeg 路径）

目录结构预览（要把依赖放进对应位置）：

```text
BiliSummarize/
├── server.js           主服务（node server.js / start.bat）
├── config.example.json 配置模板 → 复制为 config.json 修改
├── public/             前端页面（原生 HTML/JS，无需构建，直接用）
├── tools/              需自备：whisper-cli（Vulkan 版）+ ggml-large-v3-turbo.bin
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
  总结模型:  qwen/qwen3.6-35b-a3b（LM Studio localhost:1234）
```

### 第 3 步：在浏览器中使用

在 **Edge / Chrome** 打开 **http://localhost:3000**（`start.bat` 会自动打开）：
1. 粘贴 B 站视频链接（如 `https://www.bilibili.com/video/BV1xxxxxx`），也可直接填 BV 号
2. 选择识别语言（默认中文），点「**开始总结**」
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
| ffmpeg | 音频转 16kHz wav。Windows 可 `winget install ffmpeg`，或用官网全量包；把可执行文件路径写入 `config.json` 的 `ffmpeg` 字段 |
| LM Studio | 运行本地大模型（qwen3.6-35b-a3b 等），需已启动并加载模型 |

> `tools/` 体积大（whisper 构建 + 1.6GB 模型，合计约 1.7GB），**未纳入 git 仓库**。克隆后请把 whisper-cli 与模型放回 `tools/`，并复制 `config.example.json` 为 `config.json` 修改本机路径。

## 三、功能特性

- 一键总结：输入链接即得**核心概述 / 内容要点 / 关键名词 / 结语**，要点按时长自动增删、每条含具体细节（型号/数字/价格/对比）
- 本地推理：语音转写（whisper GPU）与 AI 总结（本地 Qwen）全部在本机完成，隐私安全
- 阶段耗时：完成后显示「GPU 识别 / 本地总结 / 总计」各环节耗时
- 追问对话：总结完成后可直接向本地 Qwen 追问（流式实时回答），**支持多轮对话**——模型会记住之前的问答，并结合视频内容与自身知识自由作答
- 转写缓存：同一视频重复总结自动跳过语音识别（约省一半时间）
- 官方字幕快路径：有字幕的视频直接使用字幕，无需语音识别

## 四、耗时参考（RX 9070 GRE + qwen3.6-35b-a3b）

| 环节 | 首次 | 缓存命中 |
| --- | --- | --- |
| 下载音频 + 转换 | ~2 秒 | - |
| GPU 语音转写（14 分钟视频） | ~20 秒 | - |
| 本地大模型总结 | ~20 秒 | ~20 秒 |
| **合计** | **~40 秒** | **~20 秒** |

## 五、配置（config.json）

仓库内置 `config.example.json`（示例配置）；本机 `config.json` 被 `.gitignore` 忽略、不入仓库，未存在时服务自动回退读取示例配置。请复制示例为 `config.json` 后按本机情况修改。

| 字段 | 说明 |
| --- | --- |
| `port` | 服务端口，默认 3000 |
| `whisperCli` / `whisperModel` | whisper 可执行文件与模型路径 |
| `ffmpeg` | ffmpeg 可执行文件路径 |
| `lmStudioUrl` / `lmStudioModel` | 本地大模型地址与模型名 |
| `whisperThreads` | 转写线程数 |
| `withTimestamps` | 转写是否带时间戳（默认 true，便于总结引用时间点） |
| `defaultLang` | 默认识别语言（zh / en / auto） |

## 六、工作原理

```
Edge 页面 ──> Node 后端 (localhost:3000)
                ├─ ① B站信息接口 → 标题/封面/UP主/分P
                ├─ ② 官方字幕？有→直接当文本（快路径）
                │    无↓
                ├─ ③ DASH 音频下载 → ffmpeg 转 16kHz wav
                ├─ ④ whisper-cli（Vulkan GPU）→ 转写文本
                └─ ⑤ 本地 Qwen3.6（LM Studio）→ 结构化总结 / 多轮问答
```

## 七、常见问题

- **页面提示「本地模型未连接」**：启动 LM Studio 并加载模型后再试。
- **总结很慢 / 一直转圈**：多半是没关 LM Studio 的「思考模式」，见「快速开始」第 1 步。
- **转写失败**：确认 `config.json` 里 whisper/模型路径正确，显卡驱动支持 Vulkan。
- **改端口**：修改 `config.json` 的 `port`。
- **追问提示「任务已过期」**：总结任务在服务端保留 60 分钟，超时需重新总结后再提问。

## 八、许可证

[MIT License](LICENSE)，Copyright (c) 2026 Altria Pendragon。
