# 🌐 网络与代理使用说明（B 站 / YouTube）

> 适用版本：支持 B 站 + YouTube 的 BiliSummarize。
> **一句话结论**：B 站要「国内出口 IP」，YouTube 要「境外出口 IP」——开着**全局代理**必然二选一。把代理切成**规则模式（分流）**，让 B 站走直连、YouTube 走代理，两个平台就能**同时**正常工作。

---

## 1. 为什么会互相冲突

这是实测的 A/B 结果（同一台机器，只切换代理开关）：

| 对象 | 代理开 | 代理关 |
| --- | --- | --- |
| **B 站** API | ❌ HTTP **412** + 一个 HTML 提示页 | ✅ HTTP 200 + 正常 JSON |
| **YouTube** | ✅ HTTP 200 | ❌ 连接超时（打不开） |

原因：

- **B 站**：对**境外 / 机房 / 代理 IP** 有地域风控，命中就返回 `412`（返回一个 HTML 页面而不是 JSON）。所以挂着代理访问 B 站接口会被拒——本服务会报「B 站接口返回了非 JSON 内容（HTTP 412）」。
- **YouTube**：在中国大陆无法直连，**必须**经代理才能访问。

所以在「全局代理」模式下这个问题**无解**：开了 B 站挂，关了 YouTube 挂。**这不是本项目的 bug，而是两个平台对出口 IP 的要求正好相反。**

---

## 2. 推荐方案：代理改「规则模式」分流

原理：**只让 YouTube 相关域名走代理，B 站相关域名直连**。两个平台即可同时使用。

### 2.1 需要分流的域名清单

**走代理（PROXY）—— YouTube 一侧**

| 域名 | 用途 | 漏掉的后果 |
| --- | --- | --- |
| `youtube.com` `youtu.be` `youtube-nocookie.com` | 视频页、元信息 | 取不到视频信息 |
| `googlevideo.com` | 音视频流 CDN | **音频下载失败**（最常见漏项） |
| `ytimg.com` | 封面缩略图 | 封面裂图 |
| `ggpht.com` `googleusercontent.com` | 频道头像等 | 头像不显示 |

**走直连（DIRECT）—— B 站一侧**

| 域名 | 用途 | 漏掉的后果 |
| --- | --- | --- |
| `bilibili.com`（含 `api.bilibili.com`）`b23.tv` | 主站、接口、短链 | 报 412 或取不到信息 |
| `bilivideo.com` | 音频 / 视频 CDN | **音频下载失败** |
| `hdslb.com` | 封面图 | 封面裂图 |
| `akamaized.net` | B 站部分 CDN 节点 | 偶发下载失败 |

### 2.2 各客户端怎么设

**Clash / Clash Verge / Mihomo（最常见）**
1. 把代理模式从「全局（Global）」切成「**规则（Rule）**」
2. 在配置里补上下面几条规则（放在规则列表靠前的位置）：

```yaml
rules:
  # YouTube → 走代理
  - DOMAIN-SUFFIX,youtube.com,PROXY
  - DOMAIN-SUFFIX,youtu.be,PROXY
  - DOMAIN-SUFFIX,youtube-nocookie.com,PROXY
  - DOMAIN-SUFFIX,googlevideo.com,PROXY
  - DOMAIN-SUFFIX,ytimg.com,PROXY
  - DOMAIN-SUFFIX,ggpht.com,PROXY
  - DOMAIN-SUFFIX,googleusercontent.com,PROXY
  # B 站 → 直连
  - DOMAIN-SUFFIX,bilibili.com,DIRECT
  - DOMAIN-SUFFIX,b23.tv,DIRECT
  - DOMAIN-SUFFIX,bilivideo.com,DIRECT
  - DOMAIN-SUFFIX,hdslb.com,DIRECT
  - DOMAIN-SUFFIX,akamaized.net,DIRECT
```

> `PROXY` / `DIRECT` 是本示例的策略组名，请对照你自己的配置改成实际名称（如 `🚀 节点选择` / `DIRECT`）。

**v2rayN**
- 「路由设置」里加域名规则：YouTube 相关走代理、`bilibili.com` 等设直连；
- 或直接用内置的「绕过大陆地址」预设（B 站本来就在大陆，通常能正确直连）。

**Surge / Stash / Quantumult X**
- 同样是加 `DOMAIN-SUFFIX` 规则，写进 `[Rule]` 段。

**最省事的办法**：大多数机场的默认「规则模式」本身就带 `GeoIP-CN 直连`，**直接把模式从「全局」切到「规则」，往往立刻就同时可用了**——先试这个，不行再按上面的清单补规则。

### 2.3 模式名称对照（别选错）

| 模式 | 含义 | 结果 |
| --- | --- | --- |
| 全局 / Global | 所有流量都走代理 | ❌ B 站必挂 |
| **规则 / Rule** | 按规则分流 | ✅ **推荐，两者同时可用** |
| 直连 / Direct | 所有流量都不走代理 | ❌ YouTube 必挂 |

---

## 3. 不想改代理配置：手动开关

最直接的办法：

- 总结 **B 站** → **关掉代理**
- 总结 **YouTube** → **打开代理**

注意点：

- 每次切换稍等几秒即可，**一般不需要重启本服务**（每次总结都是新建连接）。若切换后仍报 412，重启一下服务（或等几秒让旧连接释放）再试。
- **LM Studio 不受影响**（它走 `localhost:1234`，本地回环不走代理）。

---

## 4. 自查清单：我现在是哪种状态？

按顺序做，很快能定位：

1. **看出口 IP 归属地**：浏览器打开 <https://myip.ipip.net>（或 <https://ip.sb>）。显示**境外** = 代理正在生效。
2. **直接测 B 站接口**：浏览器打开
   `https://api.bilibili.com/x/web-interface/view?bvid=BV19HY76oEv3`
   - 返回 **JSON**（一堆 `{"code":0,...}`）→ B 站正常 ✅
   - 返回**网页 / 提示页**（HTML）→ 已被风控（IP 在境外）
3. **测 YouTube 能否直连**：浏览器打开 <https://www.youtube.com>，打不开就是需要代理。

> ⚠️ **一个重要澄清**：本服务页面上方的系统状态条、以及启动日志，只反映**本地组件**是否就绪（whisper / 模型 / ffmpeg / yt-dlp / LM Studio）。**它不检测网络能否访问 B 站或 YouTube**——平台网络问题会在**点「开始总结」之后**才以报错形式出现。

---

## 5. 故障对照表

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| B 站报「非 JSON 内容（HTTP 412）」 | 出口 IP 在境外（开着代理） | 关代理，或让 `bilibili.com` 走直连 |
| B 站报「音频下载失败」 | 代理拦了 `bilivideo.com` | 让 `bilivideo.com`、`akamaized.net` 直连 |
| YouTube 报「未找到 yt-dlp」 | 缺 `tools/yt-dlp.exe` | 放入该文件，或改 `config.json` 的 `ytDlp` |
| YouTube 报取流失败 / 超时 | 代理未覆盖 YouTube（常见漏 `googlevideo.com`） | 按 §2.1 补全域名；确认代理已开 |
| YouTube 报 403 / 429 等 | yt-dlp 版本旧，跟不上 YouTube 改版 | 运行 `tools\yt-dlp.exe -U` 升级 |
| 视频页能打开但总结失败 | 只有页面域名走了代理，接口 / CDN 域名没走对 | 按 §2.1 清单补全域名 |
| 封面不显示 | `hdslb.com`（B 站）或 `ytimg.com`（YouTube）没走对 | 对应域名改直连 / 走代理 |

---

## 6. 技术细节：本服务到底走不走代理？

这点容易踩坑，说明一下：

- **本服务不会主动使用「系统代理」设置**：Node 内置的 `fetch`（undici）**默认不读** `HTTP_PROXY` / `HTTPS_PROXY` 环境变量。
  - 如果你只是在 **Windows 设置里填了「系统代理」**（非 TUN），本服务访问 B 站**通常不受影响**；但 **yt-dlp 作为独立程序会读环境变量走代理**。
  - 如果你是 **TUN / 全局 VPN 模式**（在网卡层接管全部流量），那**所有程序**包括本服务都会被代理，B 站就会 412 —— **你遇到的就是这一种**。
- **LM Studio 通信走 `localhost:1234`**，属本地回环，**不受任何代理影响**。
- 用规则模式分流时，**不需要**给本服务单独配代理：B 站域名直连、YouTube 域名走代理，本服务与 yt-dlp 都会自然走对的路。

---

## 7. 快速验证命令（可选）

在 PowerShell 里执行，返回 `200` 才算通：

```powershell
# B 站接口（200 = 正常；412 = 被风控，IP 在境外）
curl.exe -s -o NUL -w "bili=%{http_code}`n" "https://api.bilibili.com/x/web-interface/view?bvid=BV19HY76oEv3"

# YouTube（200 = 可访问；000 = 不通 / 超时）
curl.exe -s -o NUL -w "yt=%{http_code}`n" "https://www.youtube.com"
```

理想的分流结果：`bili=200` 且 `yt=200`。

---

## 8. 相关文档

- `README.md` —— 安装、依赖下载、功能与常见问题
- `DEVELOPMENT.md` —— 内部技术决策与踩坑记录（§4.10 yt-dlp 取舍、§4.11 B 站 412）
- `transcribe.md` —— 独立的语音转文字批处理使用说明
