/* ===== BiliSummarize 前端逻辑 ===== */
'use strict';

const $ = (id) => document.getElementById(id);

const els = {
  url: $('url'),
  go: $('go'),
  paste: $('paste'),
  lang: $('lang'),
  sys: $('sys-status'),
  progress: $('progress-card'),
  bar: $('progress-bar'),
  msg: $('current-msg'),
  log: $('log'),
  steps: [...document.querySelectorAll('.step')],
  result: $('result'),
  cover: $('cover'),
  vtitle: $('vtitle'),
  vowner: $('vowner'),
  vduration: $('vduration'),
  vpart: $('vpart'),
  vdesc: $('vdesc'),
  overview: $('overview'),
  points: $('points'),
  keywords: $('keywords'),
  conclusion: $('conclusion'),
  errCard: $('error-card'),
  errMsg: $('error-msg'),
  errHint: $('error-hint'),
  timings: $('timings'),
  qa: $('qa'),
  qaList: $('qa-list'),
  qaInput: $('qa-input'),
  qaSend: $('qa-send'),
};

let currentES = null;
let currentJobId = null;
let videoInfo = null;
let lastResult = null;

// ---------- 系统状态 ----------
async function loadStatus() {
  try {
    const r = await fetch('/api/status');
    const st = await r.json();
    const parts = [];
    parts.push(st.lmStudio ? `<span class="ok">● 本地模型已连接</span>` : `<span class="bad">● 本地模型未连接（需启动 LM Studio）</span>`);
    parts.push(st.whisperModel ? `<span class="ok">● 转写模型就绪</span>` : `<span class="bad">● 转写模型缺失</span>`);
    parts.push(st.ffmpeg ? `<span class="ok">● ffmpeg 就绪</span>` : `<span class="bad">● ffmpeg 缺失</span>`);
    els.sys.innerHTML = parts.join('');
  } catch {
    els.sys.innerHTML = `<span class="bad">● 无法连接后端服务</span>`;
  }
}

// ---------- 输入 ----------
els.paste.addEventListener('click', async () => {
  try {
    const t = await navigator.clipboard.readText();
    if (t) els.url.value = t.trim();
  } catch {
    els.url.focus();
  }
});

els.url.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') els.go.click();
});

// 支持的链接：B 站（含裸 BV 号）与 YouTube（含 youtu.be 短链）
const SUPPORTED_URL = /BV[0-9A-Za-z]{10}|bilibili\.com|b23\.tv|youtube\.com|youtu\.be/i;

// ---------- 开始 ----------
els.go.addEventListener('click', async () => {
  const url = els.url.value.trim();
  if (!url || !SUPPORTED_URL.test(url)) {
    showError(
      '链接似乎不对',
      '请粘贴 B 站视频链接（如 https://www.bilibili.com/video/BV1xxxxxx，或直接粘贴 BV 号），或 YouTube 链接（如 https://www.youtube.com/watch?v=xxxxxxxxxxx）',
    );
    return;
  }
  startJob(url);
});

function startJob(url) {
  hideError();
  resetProgress();
  els.progress.classList.remove('hidden');
  els.result.classList.add('hidden');
  els.qa.classList.add('hidden');
  els.qaList.innerHTML = '';
  els.go.disabled = true;
  els.go.innerHTML = `<span class="go-icon">⏳</span> 处理中…`;
  addLog('任务已创建，正在连接处理管道…');

  fetch('/api/summarize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, lang: els.lang.value }),
  })
    .then((r) => r.json())
    .then((d) => {
      if (d.error) throw new Error(d.error);
      currentJobId = d.jobId;
      if (currentES) currentES.close();
      const es = new EventSource('/api/events/' + d.jobId);
      currentES = es;
      es.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data);
          handleEvent(data);
        } catch {}
      };
      // 连接断开时 EventSource 会自动重连，完成后会在 handleEvent 里手动关闭
    })
    .catch((e) => {
      showError('无法开始任务', e.message || String(e));
      els.go.disabled = false;
      els.go.innerHTML = `<span class="go-icon">▶</span> 开始总结`;
    });
}

function handleEvent(data) {
  switch (data.type) {
    case 'step':
      activateStep(data.step);
      els.msg.textContent = data.message;
      break;
    case 'note':
      addLog(data.message);
      break;
    case 'info':
      videoInfo = data.info;
      break;
    case 'done':
      finishJob(data);
      break;
    case 'error':
      showError('处理失败', data.message);
      els.go.disabled = false;
      els.go.innerHTML = `<span class="go-icon">▶</span> 开始总结`;
      break;
  }
}

// ---------- 进度 ----------
const STEP_ORDER = ['info', 'download', 'transcribe', 'summarize', 'done'];
const STEP_PCT = { info: 18, download: 40, transcribe: 70, summarize: 92, done: 100 };
// 后端还会发 subtitle / convert 两个细分步骤，都归到界面上的「字幕 / 音频」这一步
const STEP_ALIAS = { subtitle: 'download', convert: 'download' };

function activateStep(key) {
  key = STEP_ALIAS[key] || key;
  const idx = STEP_ORDER.indexOf(key);
  if (idx < 0) return;
  els.steps.forEach((s, i) => {
    s.classList.toggle('active', i === idx);
    s.classList.toggle('done', i < idx);
  });
  els.bar.style.width = STEP_PCT[key] + '%';
}

function resetProgress() {
  els.steps.forEach((s) => s.classList.remove('active', 'done'));
  els.bar.style.width = '4%';
  els.msg.textContent = '准备中…';
  els.log.innerHTML = '';
}

function addLog(t) {
  const div = document.createElement('div');
  div.textContent = '· ' + t;
  els.log.appendChild(div);
  els.log.scrollTop = els.log.scrollHeight;
}

// ---------- 结果 ----------
function finishJob(data) {
  const { result } = data;
  lastResult = { info: videoInfo, summary: result };
  activateStep('done');
  els.msg.textContent = '完成！';
  addLog('✓ 总结生成完毕');

  els.result.classList.remove('hidden');

  if (videoInfo) {
    els.cover.src = '/api/pic?url=' + encodeURIComponent(videoInfo.pic || '');
    els.vtitle.textContent = videoInfo.title || '';
    els.vowner.textContent = (videoInfo.ownerLabel || 'UP主') + '：' + (videoInfo.owner || '未知');
    els.vduration.textContent = '时长 ' + fmtDur(videoInfo.duration);
    // 分P 是 B 站特有的概念，YouTube 只有一段，分P数<=1 时整块不显示
    if (videoInfo.partCount > 1) {
      els.vpart.textContent = `第 ${videoInfo.partIndex}/${videoInfo.partCount} 个分P` + (videoInfo.part ? ' · ' + videoInfo.part : '');
      els.vpart.classList.remove('hidden');
    } else {
      els.vpart.textContent = '';
      els.vpart.classList.add('hidden');
    }
    els.vdesc.textContent = (videoInfo.desc || '').slice(0, 140);
  }

  els.overview.textContent = result.overview || '（无概述）';
  els.points.innerHTML = '';
  (result.points || []).forEach((p) => {
    const li = document.createElement('li');
    li.textContent = p;
    els.points.appendChild(li);
  });
  els.keywords.innerHTML = '';
  (result.keywords || []).forEach((k) => {
    const s = document.createElement('span');
    s.textContent = k;
    els.keywords.appendChild(s);
  });
  els.conclusion.textContent = result.conclusion || '';

  // 阶段耗时
  const t = data.timings || {};
  const tParts = [];
  if (t.subtitle) tParts.push(`字幕 ${t.subtitle}s`);
  if (t.download) tParts.push(`下载 ${t.download}s`);
  if (t.convert) tParts.push(`转换 ${t.convert}s`);
  if (t.transcribe) tParts.push(`GPU 识别 <b>${t.transcribe}s</b>`);
  if (t.summarize) tParts.push(`本地总结 <b>${t.summarize}s</b>`);
  if (t.total) tParts.push(`总计 <b>${t.total}s</b>`);
  els.timings.innerHTML =
    `<span class="timing-label">推理耗时：</span>` + tParts.map((p) => `<span class="chip">${p}</span>`).join('');

  // 打开追问区
  els.qa.classList.remove('hidden');
  els.qaList.innerHTML = '';
  els.qaInput.disabled = false;
  els.qaSend.disabled = false;

  els.go.disabled = false;
  els.go.innerHTML = `<span class="go-icon">▶</span> 开始总结`;
  if (currentES) { currentES.close(); currentES = null; }
  els.result.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function fmtDur(sec) {
  if (!sec) return '--';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

// ---------- 复制 ----------
function buildMarkdown() {
  const s = lastResult.summary;
  const info = lastResult.info || {};
  let md = `# ${info.title || '视频总结'}\n\n`;
  // 链接与作者称谓由后端按平台给出（B 站→UP主，YouTube→频道）
  const meta = [];
  if (info.link) meta.push(`- 视频链接：${info.link}`);
  if (info.owner) meta.push(`- ${info.ownerLabel || 'UP主'}：${info.owner}`);
  if (meta.length) md += meta.join('\n') + '\n\n';
  md += `## 核心概述\n${s.overview || ''}\n\n`;
  md += `## 内容要点\n`;
  (s.points || []).forEach((p, i) => (md += `${i + 1}. ${p}\n`));
  md += `\n## 关键名词\n${(s.keywords || []).join('、')}\n\n`;
  if (s.conclusion) md += `## 结语\n${s.conclusion}\n`;
  return md;
}

function buildPlain() {
  const s = lastResult.summary;
  const info = lastResult.info || {};
  let t = `${info.title || '视频总结'}\n\n`;
  t += `核心概述：\n${s.overview || ''}\n\n`;
  t += `内容要点：\n`;
  (s.points || []).forEach((p, i) => (t += `${i + 1}. ${p}\n`));
  t += `\n关键名词：${(s.keywords || []).join('、')}\n\n`;
  if (s.conclusion) t += `结语：${s.conclusion}\n`;
  return t;
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    flash('已复制到剪贴板 ✓');
  } catch {
    // 降级：选区复制
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    flash('已复制 ✓');
  }
}

$('copy-all').addEventListener('click', () => lastResult && copy(buildPlain()));
$('copy-md').addEventListener('click', () => lastResult && copy(buildMarkdown()));

function flash(text) {
  const el = document.createElement('div');
  el.textContent = text;
  el.style.cssText = 'position:fixed;left:50%;top:24px;transform:translateX(-50%);background:#1e2540;border:1px solid rgba(255,255,255,0.15);color:#fff;padding:10px 22px;border-radius:10px;z-index:99;box-shadow:0 10px 30px rgba(0,0,0,.4);font-size:14px;';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1600);
}

// ---------- 错误 ----------
function showError(title, msg) {
  els.errCard.classList.remove('hidden');
  els.errMsg.textContent = msg;
  els.errHint.textContent = buildHint(msg);
}
function hideError() { els.errCard.classList.add('hidden'); }
function buildHint(msg) {
  const m = msg || '';
  if (/本地大模型|LM Studio|未连接/.test(m)) {
    return '提示：请确认 LM Studio 已启动，并在模型加载里选择了 qwen3.6-35b-a3b 模型。';
  }
  if (/whisper-cli|转写模型/.test(m)) {
    return '提示：请确认 tools/ 目录下有 whisper-cli.exe 和 ggml-large-v3-turbo.bin（可修改 config.json）。';
  }
  if (/ffmpeg/.test(m)) {
    return '提示：请确认 ffmpeg 已安装，并在 config.json 的 ffmpeg 字段里填好路径。';
  }
  if (/412|风控|非 JSON/.test(m)) {
    return '提示：B 站会限制境外 / 代理 IP。如果你开着 VPN 或全局代理，请先关掉；或把代理切到「规则模式」让 bilibili.com 走直连（这样 B 站与 YouTube 可同时可用）。详见项目根目录的 NETWORK.md。';
  }
  if (/yt-dlp/.test(m)) {
    return '提示：YouTube 取流依赖 tools/yt-dlp.exe。请确认文件存在（路径可在 config.json 的 ytDlp 字段修改）；若是取流失败，先运行 tools\\yt-dlp.exe -U 升级。另需确认网络能访问 YouTube。';
  }
  if (/暂不支持该链接/.test(m)) {
    return '提示：目前支持 B 站与 YouTube 的视频页链接，请确认粘贴的不是专栏、动态或纯播放列表地址。';
  }
  return '';
}

// ---------- 追问 ----------
function appendQA(role, text, thinking) {
  const b = document.createElement('div');
  b.className = 'qa-bubble ' + (role === 'user' ? 'qa-user' : 'qa-assistant' + (thinking ? ' thinking' : ''));
  b.textContent = text;
  els.qaList.appendChild(b);
  els.qaList.scrollTop = els.qaList.scrollHeight;
  return b;
}

async function askQuestion(question) {
  if (!currentJobId) {
    appendQA('assistant', '任务已过期，请重新总结后再提问。');
    return;
  }
  appendQA('user', question);
  const bubble = appendQA('assistant', '', true);
  bubble.textContent = 'Qwen 正在思考…';
  els.qaInput.value = '';
  els.qaInput.disabled = true;
  els.qaSend.disabled = true;

  try {
    const r = await fetch('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId: currentJobId, question }),
    });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      throw new Error(e.error || '请求失败（HTTP ' + r.status + '）');
    }
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    let answer = '';
    let started = false;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        for (const line of chunk.split('\n')) {
          if (!line.startsWith('data:')) continue;
          try {
            const ev = JSON.parse(line.slice(5).trim());
            if (ev.error) {
              bubble.className = 'qa-bubble qa-assistant';
              bubble.textContent = '⚠️ ' + ev.error;
              answer = '';
            } else if (ev.text) {
              if (!started) {
                started = true;
                bubble.className = 'qa-bubble qa-assistant';
                bubble.textContent = '';
              }
              answer += ev.text;
              bubble.textContent = answer;
              const c = document.createElement('span');
              c.className = 'cursor';
              bubble.appendChild(c);
              els.qaList.scrollTop = els.qaList.scrollHeight;
            }
          } catch {}
        }
      }
    }
    if (!started && !answer) bubble.textContent = '（没有获得回答）';
    else bubble.querySelector('.cursor') && bubble.querySelector('.cursor').remove();
  } catch (e) {
    bubble.className = 'qa-bubble qa-assistant';
    bubble.textContent = '⚠️ ' + (e.message || String(e));
  } finally {
    els.qaInput.disabled = false;
    els.qaSend.disabled = false;
    els.qaInput.focus();
  }
}

els.qaSend.addEventListener('click', () => {
  const q = els.qaInput.value.trim();
  if (q) askQuestion(q);
});
els.qaInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const q = els.qaInput.value.trim();
    if (q) askQuestion(q);
  }
});

loadStatus();
