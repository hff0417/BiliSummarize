# 📘 BiliSummarize 开发文档

> 本文件记录项目的**设计思路、技术决策、开发历程与踩坑记录**，供后续维护和二次开发参考。
> 面向对象：接手的 Claude / 开发者。**环境事实、决策原因、坑点**都写在这里，避免重复推导。

---

## 1. 项目定位

**本地运行的 B 站视频要点总结工具**。用户粘贴 B 站视频链接 → 自动下载音频 → GPU 语音转写 → 本地大模型总结要点，全程不出本机、免费、隐私安全。附带**基于视频内容的多轮问答**。

**运行形态**：单机 Web 应用（Node.js 后端 + 纯前端静态页面），通过 Edge/Chrome 打开 `http://localhost:3000` 使用。**零 npm 运行时依赖**（只用 Node 内置模块）。

---

## 2. 用户机器环境（重要前提，勿假设通用）

以下环境事实决定了所有技术选型，**换机器时需重新核对**：

| 项目 | 事实 |
| --- | --- |
| 操作系统 | Windows 11（中文） |
| CPU | AMD Ryzen 7 9700X（8 核） |
| 内存 | 33 GB |
| GPU | **AMD RX 9070 GRE（12 GB 显存）** |
| Node.js | v24（已有；**系统无 Python**，仅商店占位） |
| LM Studio | 已安装并运行，监听 `localhost:1234`（OpenAI 兼容 API），已加载 `qwen/qwen3.6-35b-a3b` |
| 大模型能力上限 | Qwen3.6-35B-A3B（Q4_K，35B 总参/3B 激活，12GB 显存放不下全量，部分离屏到内存） |
| ffmpeg | 已装于 `D:\ffmpeg-9.0.1-full_build\bin`（用户手动配置） |
| whisper-cli | **Vulkan 版** `whisper-v1.8.4-windows-vulkan-x64`（用户自备，已拷入项目 `tools/`） |

---

## 3. 架构总览

```
┌──────────┐   HTTP/SSE   ┌─────────────────────────────────────────────┐
│ Edge 前端 │ ──────────▶ │ Node 后端 (server.js, 零依赖)                │
│ public/   │             │   ├ lib/bilibili.js    视频信息/字幕/音频下载 │
└──────────┘             │   ├ lib/transcribe.js  封装 whisper-cli      │
                          │   ├ lib/summarize.js   总结 + 多轮问答        │
                          │   └ 任务队列(串行) + SSE 进度 + 转写缓存       │
                          └────────┬────────────┬───────────────────────┘
                                   │            │
                         B 站 API   │            │  本地 HTTP
                 https://api.bilibili.com    LM Studio localhost:1234
                          │            │            │
                  DASH 音频下载     whisper-cli   Qwen3.6-35B-A3B
                                   (Vulkan GPU)   (总结/问答)
```

**数据流（一次总结）**：
`URL → parseUrl → getVideoInfo → getSubtitle(快路径，无则跳过) → 转写缓存(命中则跳过) → getAudioUrl → downloadAudio → ffmpegToWav → transcribe → summarize → done(含 timings)`

**关键设计**：后端**任务串行**（`enqueue`），避免 GPU/本地模型并发争抢；进度通过 **SSE** 实时推给前端。

---

## 4. 关键技术决策与原因（踩坑记录）

这些是开发过程中最重要的判断，理解它们才能维护好项目。

### 4.1 为什么转写不用 LM Studio？
用户最初想让 LM Studio 直接跑 whisper（它看起来支持）。实测：
- `POST /v1/audio/transcriptions` 行为反常（415 / "Unexpected endpoint"）
- 加载 whisper GGUF 模型时报 **`unknown model architecture: 'whisper'`** —— LM Studio 内部用 **llama.cpp**，只认 LLM 架构，解析不了 whisper（whisper 是独立架构，属于 whisper.cpp）
- **结论：whisper 不能跑在 LM Studio，必须用 whisper.cpp 本体。**

### 4.2 为什么用 whisper.cpp 的 Vulkan 版（而非 CUDA / faster-whisper）？
- 用户是 **AMD GPU**，CUDA 不可用（faster-whisper 的 CTranslate2 CUDA 后端不认 A 卡）
- 官方 whisper.cpp 预编译包只有 CPU / CUDA 两种，但社区有 **Windows Vulkan 预编译版**（用户自备），Vulkan 在 AMD 上原生可用
- whisper-large-v3-turbo 在 9070 GRE 上实测 **~60 倍实时**（807 秒音频 13 秒转完），中文识别质量好

### 4.3 为什么总结用 LM Studio 的 Qwen3.6 而不是 API key？
- 机器上已有 LM Studio + Qwen3.6-35B-A3B（Q4_K），免费、本地、隐私
- 实测总结质量高（能抓到视频里的细节、连插播广告都能识别出来）

### 4.4 ⚠️ Qwen 思考模式（Thinking）是最大的坑
- Qwen3.6 默认开启思考模式：API 响应里 `reasoning_content` 会生成**巨长推理链**（简单问题都要 2000+ 字推理），把 `max_tokens` 吃光 → `content` 为空、耗时长
- 尝试过 `thinking:false` / `think:false` / `enable_thinking:false` / `reasoning_effort` 等参数，**LM Studio 都不认**（当时版本无效）
- **解决：在 LM Studio 里关闭模型的「Enable Thinking」开关**，位置：**「终端（Terminal）→ Inference → 自定义字段（Custom Fields）→ Enable Thinking」**，关闭后**必须重新加载模型才生效**（改设置后不重载无效）。API 参数 `thinking:false` / `think:false` / `enable_thinking:false` / `reasoning_effort` 实测一律无效
- 关闭后：简单任务从 26s → **2.4s**；总结从「超 6 分钟」→ **20s**
- 代码里保留了防御：若 content 为空，用更大的 max_tokens 重试一次

### 4.5 B 站接口的签名玄学
- **信息接口** `x/web-interface/view`：无需签名，匿名可访问
- **字幕接口** `x/player/wbi/v2`：需要 wbi 签名（`img_key+sub_key → mixinKey → md5`），匿名多数视频返回空字幕
- **音频接口** `x/player/playurl`：**加 wbi 签名反而报 `-400`，不加签名反而成功**（`bvid+cid+platform=pc&fnval=16`）。直接用无签名方案
- 音频下载需带 `Referer: https://www.bilibili.com/` 和浏览器 UA

### 4.6 whisper 时间戳的坑
- `-otxt` 输出的 txt 文件**不带时间戳**（是纯文本）；**时间戳只在 stdout** 里
- 用户用 PowerShell `>` 重定向得到的是 **UTF-16** 编码（PowerShell 重定向特性），Node 读会乱码
- **解决**：后端直接**抓 whisper 的 stdout**（UTF-8），格式 `[00:00:00.620 --> 00:00:03.160]  文本`，默认保留时间戳供总结引用；`config.withTimestamps:false` 时加 `-nt` 输出纯文本

### 4.7 SSE 与测试脚本的坑
- SSE 连接会一直保持（心跳 ping 每 15s），**不会自动关闭**。测试脚本若傻等流结束（`reader.read()` done）会**永远挂起**——真正的前端是按事件即时渲染的，收到 `done` 就主动 `EventSource.close()`
- 本项目测试脚本踩过「看起来卡住」的坑，实为测试脚本未退出，非应用 bug

### 4.8 多轮问答的实现
- 视频上下文（标题+概要+转写文本+回答规则）作为**固定的 system 消息**
- 历史问答作为消息数组逐轮追加（`job.history`，保留最近 10 轮）
- `ask()` 流式返回（LM Studio `stream:true`，转发 `delta.content`），前端用 fetch reader 逐 token 渲染

### 4.9 问答策略：「视频优先、知识自由」
- 初期限定「只按视频内容回答」，用户反馈无法发散提问（总回「视频未提及」）
- 改为：**视频相关优先引用视频数据；视频外的问题结合模型自身知识完整回答**，不再拒绝

---

## 5. 文件结构与职责

```
D:\BILIBILI\
├── server.js            主服务：HTTP 路由、SSE、任务队列(串行)、图片代理、状态接口、流水线编排
├── config.json          全部可配置项（路径/端口/模型/语言/时间戳）
├── package.json         name/start 脚本（无第三方依赖）
├── start.bat            双击启动：校验 node → 建 temp → 开浏览器 → 跑 server
├── lib/
│   ├── bilibili.js      parseUrl(含 b23.tv 短链)、getVideoInfo、getSubtitle(wbi)、getAudioUrl(无签名)、downloadAudio
│   ├── transcribe.js    封装 whisper-cli：spawn、抓 stdout、10 分钟超时
│   └── summarize.js     buildPrompt(按时长缩放要点数)、summarize(JSON 解析)、ask(多轮流式)、callLm(统一超时/错误)
├── public/              前端（原生 HTML/CSS/JS，无框架）
│   ├── index.html       页面结构：输入区、隐私条、进度、结果、追问区、署名
│   ├── style.css        深色玻璃拟态主题
│   └── app.js           状态检查、SSE 订阅、进度渲染、结果渲染、复制、追问流式
├── tools/               运行时工具（本地已拷入、勿删；体积大不入 git 仓库，克隆后需按 README 自备）
│   ├── whisper-v1.8.4-windows-vulkan-x64/  whisper-cli.exe + DLL
│   └── ggml-large-v3-turbo.bin             转写模型(~1.6GB)
└── temp/                运行时缓存（音频/转写文本，自动生成）
```

---

## 6. API 说明

| 接口 | 方法 | 说明 |
| --- | --- | --- |
| `/api/summarize` | POST | 入参 `{url, lang}` → 返回 `{jobId}` |
| `/api/events/:jobId` | GET | SSE 进度流，事件类型：`step/info/note/done/error`；`done` 含 `result + timings` |
| `/api/ask` | POST | 入参 `{jobId, question}` → SSE 流式返回 `{text}` / `{done}` / `{error}` |
| `/api/status` | GET | 返回 whisper/ffmpeg/LM Studio 就绪状态 |
| `/api/pic?url=` | GET | 图片代理（绕过封面热链/跨域） |

**SSE 事件类型**：
- `step`：进度步骤（info/download/convert/transcribe/summarize）
- `info`：视频信息（标题/封面/UP主/分P）
- `note`：提示（字幕命中/缓存命中/转写完成字数）
- `done`：`{result:{overview,points,keywords,conclusion}, transcriptLen, timings:{subtitle,download,convert,transcribe,summarize,total}}`
- `error`：错误信息

---

## 7. 性能实测数据（用户机器）

| 场景 | 耗时 |
| --- | --- |
| GPU 转写 14 分钟视频 | ~13-21 秒（约 60 倍实时） |
| 本地总结（Qwen，思考关闭） | ~20 秒 |
| 完整首次总结 | ~40 秒 |
| 缓存命中重复总结 | ~20 秒 |
| 一次追问（流式） | 5-15 秒 |

---

## 8. 已知限制 & 后续可改进

- **思考模式依赖手动关闭**：换模型/重装后需在 LM Studio GUI 手动关 Thinking 并重载模型（目前无 API 方式，踩坑见 4.4）
- **单机单任务**：任务串行，一次只能处理一个视频（避免 GPU 争抢）
- **分P视频**：默认取 URL 里 `p=` 指定的分P（无 p 取第一P），未做全 P 批量
- **多轮上下文上限**：追问保留最近 10 轮
- 可改进方向：分P 批量/选集 UI、多模型切换、结果本地历史记录、追问历史复制导出、GPU 与 LM Studio 显存协同策略

---

## 9. 维护提示

- **加功能优先看 `lib/summarize.js` 的提示词**（总结质量、问答策略都在这里改）
- **改路径/端口/模型**：全部走 `config.json`，代码里用 `path.resolve` 相对项目根解析
- **测试**：用 curl/Node 直接打 `/api/summarize` + `/api/events/:id` 即可（SSE 流注意主动断连，见 4.7）
- **启动**：`node server.js` 或双击 `start.bat`
