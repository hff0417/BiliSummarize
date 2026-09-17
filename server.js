// server.js — BiliSummarize 本地服务（零 npm 依赖）
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { spawn } = require('node:child_process');

const ROOT = __dirname;
const cfg = loadConfig();

const { resolve, supportedLabels, picHeaders, buildInfoView } = require('./lib/providers');
const { transcribe } = require('./lib/transcribe');
const { summarize, ask } = require('./lib/summarize');

// ---------- 配置 ----------
function loadConfig() {
  // 优先读本机 config.json（用户自配，已 .gitignore 不入仓库）；缺失时回退到仓库内置的 config.example.json
  const configPath = path.join(ROOT, 'config.json');
  const fallbackPath = path.join(ROOT, 'config.example.json');
  const readFrom = fs.existsSync(configPath) ? configPath : fallbackPath;
  const raw = JSON.parse(fs.readFileSync(readFrom, 'utf8'));
  const resolve = (p) => (path.isAbsolute(p) ? p : path.join(ROOT, p));
  raw.whisperCli = resolve(raw.whisperCli);
  raw.whisperModel = resolve(raw.whisperModel);
  raw.ffmpeg = resolve(raw.ffmpeg);
  raw.ytDlp = resolve(raw.ytDlp || 'tools/yt-dlp.exe');
  raw.tempDir = resolve(raw.tempDir || 'temp');
  fs.mkdirSync(raw.tempDir, { recursive: true });
  return raw;
}

// ---------- 工具 ----------
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 1e6) {
        reject(new Error('请求体过大'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new Error('JSON 解析失败'));
      }
    });
    req.on('error', reject);
  });
}

function ffmpegToWav(input, output) {
  return new Promise((resolve, reject) => {
    const child = spawn(cfg.ffmpeg, ['-y', '-loglevel', 'error', '-i', input, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', output], {
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
    });
    let err = '';
    child.stderr.on('data', (d) => (err += d.toString()));
    child.on('error', (e) => {
      reject(e.code === 'ENOENT' ? new Error('未找到 ffmpeg，请检查 config.json 里的 ffmpeg 路径') : e);
    });
    child.on('close', (code) => {
      if (code === 0 && fs.existsSync(output)) resolve();
      else reject(new Error('音频转换失败：' + (err.trim().split('\n').pop() || `exit ${code}`)));
    });
  });
}

// ---------- 任务队列 ----------
const jobs = new Map();
let queue = Promise.resolve();
function enqueue(fn) {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

function createJob(url, lang) {
  const id = crypto.randomBytes(4).toString('hex');
  const emitter = new EventEmitter();
  const job = { id, url, lang, emitter, history: [], log: [] };
  jobs.set(id, job);

  // 事件既实时推给订阅者，也顺序留档：任务可能在页面连上 SSE 之前就结束了
  // （例如「链接不被支持」这种不经过网络的秒失败），后到的客户端靠留档仍能拿到结果，
  // 否则前端会一直停在转圈状态。回放逻辑见 handleEvents。
  const emit = (data) => {
    job.log.push(data);
    emitter.emit('event', data);
  };

  enqueue(async () => {
    try {
      await runPipeline(job, emit);
    } catch (e) {
      emit({ type: 'error', message: e && e.message ? e.message : String(e) });
    }
  }).finally(() => {
    // 任务结果保留 60 分钟，供页面重连与追问使用
    setTimeout(() => jobs.delete(id), 60 * 60 * 1000);
  });
  return id;
}

async function runPipeline(job, emit) {
  // 按域名路由到对应平台适配层（lib/providers/）
  const provider = resolve(job.url);
  if (!provider) {
    throw new Error(
      `暂不支持该链接。目前支持：${supportedLabels().join(' / ')}` +
        '（B 站 bilibili.com / b23.tv，YouTube youtube.com / youtu.be）',
    );
  }
  const ref = await provider.parseUrl(job.url);
  if (!ref) throw new Error(`无法从链接中解析出 ${provider.label} 视频 ID，请检查链接后重试`);

  const times = {};
  const tStart = Date.now();
  const ms = (t) => Math.max(0, Math.round((Date.now() - t) / 1000));

  emit({ type: 'step', step: 'info', message: '正在获取视频信息…' });
  const info = await provider.getInfo(ref, cfg); // 内部会补齐 ref.partKey
  job.info = info;
  const infoView = buildInfoView(info, ref);
  emit({ type: 'info', info: infoView });

  // 快路径：官方字幕
  let transcript = null;
  try {
    emit({ type: 'step', step: 'subtitle', message: '尝试获取官方字幕…' });
    const tSub = Date.now();
    transcript = await provider.getTranscript(ref, info, cfg);
    times.subtitle = ms(tSub);
    if (transcript) emit({ type: 'note', message: '✓ 已获取官方字幕，无需语音识别' });
  } catch {
    transcript = null;
  }

  // 转写缓存：同一视频重复总结可秒出（文件名带平台特征，跨平台不会撞名）
  const key = provider.fileKey(ref);
  const cacheTxt = path.join(cfg.tempDir, `${key}.transcript.txt`);
  if (!transcript && fs.existsSync(cacheTxt) && fs.statSync(cacheTxt).size > 0) {
    transcript = fs.readFileSync(cacheTxt, 'utf8').trim();
    emit({ type: 'note', message: '✓ 使用已缓存的转写文本（跳过重新识别）' });
  }

  if (!transcript) {
    emit({ type: 'step', step: 'download', message: '正在下载音频…' });
    const tDl = Date.now();
    const audio = await provider.downloadAudio(ref, cfg.tempDir, cfg);
    times.download = ms(tDl);

    emit({ type: 'step', step: 'convert', message: '正在转换音频格式…' });
    const tCv = Date.now();
    const wav = path.join(cfg.tempDir, `${key}.wav`);
    await ffmpegToWav(audio, wav);
    times.convert = ms(tCv);

    emit({ type: 'step', step: 'transcribe', message: 'GPU 语音识别中，约需 10~30 秒…' });
    const tTr = Date.now();
    transcript = await transcribe(wav, job.lang, cfg);
    times.transcribe = ms(tTr);
    fs.writeFileSync(cacheTxt, transcript);
    emit({ type: 'note', message: `✓ 语音识别完成，转写文本约 ${(transcript.length / 1000).toFixed(0)} 千字` });
  }
  job.transcript = transcript;

  emit({ type: 'step', step: 'summarize', message: '本地大模型总结中…' });
  const tSu = Date.now();
  const summary = await summarize(transcript, info, cfg);
  times.summarize = ms(tSu);
  times.total = ms(tStart);
  job.summary = summary;

  emit({ type: 'done', result: summary, transcriptLen: transcript.length, timings: times, video: infoView });
}

// ---------- HTTP 服务 ----------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function serveStatic(req, res) {
  const clean = decodeURIComponent(req.url.split('?')[0]);
  const rel = clean === '/' ? '/index.html' : clean;
  const file = path.join(ROOT, 'public', path.normalize(rel));
  if (!file.startsWith(path.join(ROOT, 'public'))) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end('Not Found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}

async function handleStatus(res) {
  const st = {
    whisperCli: fs.existsSync(cfg.whisperCli),
    whisperModel: fs.existsSync(cfg.whisperModel),
    ffmpeg: fs.existsSync(cfg.ffmpeg),
    ytDlp: fs.existsSync(cfg.ytDlp),
    lmStudio: false,
    lmStudioModels: [],
    lmStudioMatch: false,
    config: {
      whisperCli: cfg.whisperCli,
      whisperModel: cfg.whisperModel,
      ffmpeg: cfg.ffmpeg,
      ytDlp: cfg.ytDlp,
      lmStudioModel: cfg.lmStudioModel,
    },
  };
  try {
    const r = await fetch(cfg.lmStudioUrl + '/models', { signal: AbortSignal.timeout(2500) });
    const j = await r.json();
    st.lmStudio = true;
    st.lmStudioModels = (j.data || []).map((m) => m.id);
    st.lmStudioMatch = st.lmStudioModels.some((id) => id === cfg.lmStudioModel || id.includes(cfg.lmStudioModel.split('/').pop()));
  } catch {
    st.lmStudio = false;
  }
  sendJson(res, 200, st);
}

function handlePic(req, res) {
  const target = new URL(req.url, 'http://x').searchParams.get('url');
  if (!target) return sendJson(res, 400, { error: 'missing url' });
  // 请求头按封面图所在平台给（B 站必须带 Referer，YouTube 带了反而可能被拒）
  fetch(target, { headers: picHeaders(target) })
    .then(async (r) => {
      const buf = Buffer.from(await r.arrayBuffer());
      res.writeHead(200, {
        'Content-Type': r.headers.get('content-type') || 'image/jpeg',
        'Cache-Control': 'public, max-age=86400',
      });
      res.end(buf);
    })
    .catch(() => res.writeHead(502).end());
}

function handleEvents(req, res) {
  const id = req.url.split('/').pop();
  const job = jobs.get(id);
  if (!job) {
    res.writeHead(404);
    return res.end('job not found');
  }
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write('retry: 2000\n\n');
  // 先回放任务已产生的事件（包括抢在本次连接之前就发出的），再转入实时推送。
  // 这段回放与下面的订阅之间没有 await，Node 单线程下不会漏事件。
  for (const ev of job.log || []) res.write(`data: ${JSON.stringify(ev)}\n\n`);
  const on = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);
  job.emitter.on('event', on);
  const ping = setInterval(() => res.write(': ping\n\n'), 15000);
  req.on('close', () => {
    clearInterval(ping);
    job.emitter.off('event', on);
  });
}

async function handleSummarize(req, res) {
  const body = await readBody(req);
  const url = String(body.url || '').trim();
  const lang = ['zh', 'en', 'auto'].includes(body.lang) ? body.lang : cfg.defaultLang;
  if (!url) return sendJson(res, 400, { error: '缺少视频链接' });
  const id = createJob(url, lang);
  sendJson(res, 200, { jobId: id });
}

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

// 流式追问：POST /api/ask { jobId, question } → SSE 输出
async function handleAsk(req, res) {
  const body = await readBody(req);
  const jobId = String(body.jobId || '');
  const question = String(body.question || '').trim();
  if (!jobId || !question) return sendJson(res, 400, { error: '缺少参数' });

  const job = jobs.get(jobId);
  if (!job || !job.transcript) return sendJson(res, 404, { error: '该视频的任务已过期，请重新总结后再提问' });

  const info = job.info || {};
  const sse = (obj) => {
    if (!res.writableEnded) {
      try {
        res.write(`data: ${JSON.stringify(obj)}\n\n`);
      } catch {
        /* 连接已断开 */
      }
    }
  };

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write('retry: 2000\n\n');
  sse({ text: '' });

  try {
    await enqueue(async () => {
      const history = job.history || [];
      const answer = await ask(job.transcript, info, job.summary || null, history, question, cfg, (delta) => sse({ text: delta }));
      // 追加到多轮历史（保留最近 10 轮 = 20 条消息）
      job.history = [...history, { role: 'user', content: question }, { role: 'assistant', content: answer }].slice(-20);
      sse({ done: true, answer });
    });
  } catch (e) {
    sse({ error: e && e.message ? e.message : String(e) });
  }
  res.end();
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  try {
    if (req.method === 'GET' && (p === '/' || p === '/index.html' || p === '/style.css' || p === '/app.js' || p === '/favicon.svg')) {
      return serveStatic(req, res);
    }
    if (req.method === 'GET' && p === '/api/status') return handleStatus(res);
    if (req.method === 'GET' && p === '/api/pic') return handlePic(req, res);
    if (req.method === 'GET' && p.startsWith('/api/events/')) return handleEvents(req, res);
    if (req.method === 'POST' && p === '/api/summarize') return handleSummarize(req, res).catch((e) => sendJson(res, 400, { error: e.message }));
    if (req.method === 'POST' && p === '/api/ask') return handleAsk(req, res).catch((e) => sendJson(res, 400, { error: e.message }));
    res.writeHead(404);
    res.end('Not Found');
  } catch (e) {
    sendJson(res, 500, { error: e.message });
  }
});

server.listen(cfg.port, () => {
  console.log('');
  console.log('  🎬  BiliSummarize 已启动');
  console.log('  ────────────────────────────────');
  console.log(`  打开页面:  http://localhost:${cfg.port}`);
  console.log(`  转写引擎:  ${fs.existsSync(cfg.whisperCli) ? 'whisper-cli (Vulkan GPU) ✅' : 'whisper-cli 未找到 ❌'}`);
  console.log(`  转写模型:  ${fs.existsSync(cfg.whisperModel) ? 'whisper-large-v3-turbo ✅' : '模型文件未找到 ❌'}`);
  console.log(`  ffmpeg:    ${fs.existsSync(cfg.ffmpeg) ? '已就绪 ✅' : '未找到 ❌'}`);
  console.log(`  yt-dlp:    ${fs.existsSync(cfg.ytDlp) ? '已就绪 ✅（YouTube 取流）' : '未找到 ❌（YouTube 将不可用）'}`);
  console.log(`  支持平台:  ${supportedLabels().join(' / ')}`);
  console.log(`  总结模型:  ${cfg.lmStudioModel}（LM Studio localhost:1234）`);
  console.log('');
});
