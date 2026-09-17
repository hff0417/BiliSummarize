// youtube.js — YouTube provider（信息 / 字幕快路径 / 音频下载）
// 取流统一走 yt-dlp 外部二进制（与 ffmpeg / whisper-cli 同类），避免自己维护
// YouTube 的签名与限流对抗。零 npm 依赖的约定不变。
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const id = 'youtube';
const label = 'YouTube';

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const AUDIO_EXT = /\.(webm|m4a|mp4|opus|ogg|mp3|aac|wav|3gp|mkv|flac)$/i;

// ---------- 适配层接口 ----------

/** 是否是 YouTube 链接（含裸 11 位 videoId） */
function match(url) {
  const u = String(url || '').trim();
  if (VIDEO_ID.test(u)) return true;
  try {
    const { hostname } = new URL(u);
    return /(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/i.test(hostname);
  } catch {
    return false;
  }
}

/** 解析出 videoId：支持 watch?v= / youtu.be / shorts / embed / live */
function parseUrl(rawUrl) {
  const raw = String(rawUrl || '').trim();
  if (VIDEO_ID.test(raw)) return makeRef(raw);

  let u;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (!/(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/i.test(u.hostname)) return null;

  let vid = null;
  if (/(^|\.)youtu\.be$/i.test(u.hostname)) {
    vid = u.pathname.split('/').filter(Boolean)[0];
  } else if (u.pathname === '/watch') {
    vid = u.searchParams.get('v');
  } else {
    const m = u.pathname.match(/^\/(?:shorts|embed|live|v)\/([A-Za-z0-9_-]{11})/);
    if (m) vid = m[1];
  }
  if (!vid || !VIDEO_ID.test(vid)) return null;
  return makeRef(vid);
}

function makeRef(vid) {
  // part 固定为 1：YouTube 视频没有「分P」概念，但统一接口保留该字段
  return { id: vid, part: 1, partIndex: 0, partKey: vid, url: `https://www.youtube.com/watch?v=${vid}` };
}

/**
 * 视频信息。顺带把可用字幕语种记到 info.subtitleLangs，
 * 这样 getTranscript 就能「只下载要用的那一条字幕」，避免多语言请求触发 429。
 */
async function getInfo(ref, cfg) {
  const { code, out, err } = await runYtDlp(
    cfg,
    ['--no-warnings', '--skip-download', '--no-playlist', '-J', ref.url],
    180000,
  );
  if (code !== 0) throw new Error('获取 YouTube 视频信息失败：' + lastErr(err));

  let d;
  try {
    d = JSON.parse(out);
  } catch {
    throw new Error('解析 YouTube 视频信息失败（yt-dlp 返回内容异常）');
  }

  const duration = typeof d.duration === 'number' ? d.duration : null;
  return {
    platform: id,
    platformLabel: label,
    ownerLabel: '频道',
    id: ref.id,
    link: ref.url,
    title: d.title || '（无标题）',
    desc: d.description || '',
    pic: pickThumb(d),
    owner: d.channel || d.uploader || '',
    duration,
    pubdate: parseUploadDate(d.upload_date),
    parts: [{ key: ref.id, label: '正片', duration }],
    subtitleLangs: {
      manual: Object.keys(d.subtitles || {}),
      auto: Object.keys(d.automatic_captions || {}),
      original: d.language || null,
    },
  };
}

/**
 * 字幕快路径：优先人工字幕（中文 > 原语言 > 英文），其次自动字幕（原语言 > 英文 > 中文）。
 * 「人工中文」排第一是因为用户用中文提问；「自动中文」排在英文后面，是因为 YouTube 的中文
 * 自动字幕多数是机翻，质量通常不如原语言自动字幕（Qwen 直接读英文也没问题）。
 * 没有字幕返回 null，由 GPU 转写兜底。
 */
async function getTranscript(ref, info, cfg) {
  const langs = (info && info.subtitleLangs) || { manual: [], auto: [] };
  const original = langs.original;
  const manual = pickLang(langs.manual || [], true, original);
  const auto = manual ? null : pickLang(langs.auto || [], false, original);
  const lang = manual || auto;
  if (!lang) return null;

  const stem = `${fileKey(ref)}.sub`;
  cleanSubFiles(cfg.tempDir, stem);

  const args = [
    '--no-warnings', '--skip-download', '--no-playlist',
    '--sub-format', 'vtt', '--sub-langs', lang,
    '-o', path.join(cfg.tempDir, `${stem}.%(ext)s`),
    manual ? '--write-subs' : '--write-auto-subs',
    ref.url,
  ];
  // 字幕拿不到不算致命错误，交给语音识别兜底
  try {
    await runYtDlp(cfg, args, 180000);
  } catch {
    return null;
  }

  const files = listSubFiles(cfg.tempDir, stem);
  let text = '';
  for (const f of files) {
    try {
      text = parseVtt(fs.readFileSync(f, 'utf8'));
    } catch {
      /* 换下一个 */
    }
    if (text) break;
  }
  // 字幕是中间产物，解析完即删（音频/转写文本才是缓存）
  for (const f of files) {
    try {
      fs.unlinkSync(f);
    } catch {
      /* 忽略 */
    }
  }
  return text || null;
}

/** 下载音频（bestaudio，多为 webm/opus，交给 ffmpeg 转 16k 单声道），返回本地文件绝对路径 */
async function downloadAudio(ref, destDir, cfg) {
  const stem = fileKey(ref);
  // 清掉上次残留的同名音频，避免底部的目录兜底逻辑误用旧文件
  for (const f of fs.readdirSync(destDir)) {
    if (f.startsWith(stem + '.') && AUDIO_EXT.test(f)) {
      try {
        fs.unlinkSync(path.join(destDir, f));
      } catch {
        /* 忽略 */
      }
    }
  }

  const { code, out, err } = await runYtDlp(
    cfg,
    [
      '--no-warnings', '--no-playlist', '--no-simulate',
      '-f', 'bestaudio/best',
      '-o', path.join(destDir, `${stem}.%(ext)s`),
      '--print', 'after_move:filepath',
      ref.url,
    ],
    30 * 60 * 1000,
  );

  // --print after_move:filepath 会把最终文件路径打到 stdout，取最后一条真实存在的
  const printed = String(out || '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  for (let i = printed.length - 1; i >= 0; i--) {
    if (fs.existsSync(printed[i])) return printed[i];
  }
  // 兜底：扫目录
  const found = fs
    .readdirSync(destDir)
    .filter((f) => f.startsWith(stem + '.') && AUDIO_EXT.test(f))
    .map((f) => path.join(destDir, f));
  if (found.length) return found[0];

  throw new Error(
    '音频下载失败：' + (lastErr(err) || `yt-dlp 退出码 ${code}`) + '（可尝试更新 yt-dlp：yt-dlp -U）',
  );
}

/** 缓存/临时文件唯一键。用 yt_ 前缀与 B 站（BVid_cid）区分开 */
function fileKey(ref) {
  return `yt_${ref.id}`;
}

// ---------- 内部工具 ----------

function runYtDlp(cfg, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const bin = cfg.ytDlp;
    if (!bin || !fs.existsSync(bin)) {
      return reject(
        new Error('未找到 yt-dlp：请把 yt-dlp.exe 放入 tools/ 目录（或在 config.json 里改 ytDlp 路径）'),
      );
    }
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d.toString()));
    child.stderr.on('data', (d) => (err += d.toString()));

    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('yt-dlp 执行超时'));
    }, timeoutMs);

    child.on('error', (e) => {
      clearTimeout(timer);
      reject(new Error('启动 yt-dlp 失败：' + e.message));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, out, err });
    });
  });
}

/** 挑一条可用的语言：preferZh 时中文优先；否则原语言 > 英文 > 中文 */
function pickLang(available, preferZhFirst, original) {
  if (!Array.isArray(available) || !available.length) return null;
  const lc = (s) => String(s).toLowerCase();
  const zh = (s) => s.startsWith('zh');
  const orig = original ? lc(original) : null;

  const rules = [];
  if (preferZhFirst) {
    rules.push(zh);
    if (orig) rules.push((s) => s === orig || s.startsWith(orig + '-'));
    rules.push((s) => s.startsWith('en'));
  } else {
    if (orig) rules.push((s) => s === orig || s.startsWith(orig + '-'));
    rules.push((s) => s.startsWith('en'));
    rules.push(zh);
  }
  for (const rule of rules) {
    const hit = available.find((l) => rule(lc(l)));
    if (hit) return hit;
  }
  return available[0];
}

/** 选封面：不取 maxresdefault（部分视频 404 会变裂图），取 640 以内最大的一张 */
function pickThumb(d) {
  const list = (Array.isArray(d.thumbnails) ? d.thumbnails : []).filter((t) => t && t.url);
  const mid = list
    .filter((t) => (t.width || 0) <= 640)
    .sort((a, b) => (b.width || 0) - (a.width || 0))[0];
  return (mid && mid.url) || d.thumbnail || `https://i.ytimg.com/vi/${d.id}/hqdefault.jpg`;
}

/** YouTube 的 upload_date 形如 20050424 */
function parseUploadDate(s) {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(String(s || ''));
  if (!m) return null;
  return Math.floor(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 1000);
}

/**
 * VTT → 纯文本。
 * 去掉头部、cue 序号、时间轴与内联标签，并合并相邻重复行
 * （YouTube 自动字幕是滚动式的，同一个句子会被切成多条重复 cue）。
 */
function parseVtt(vtt) {
  const out = [];
  const lines = String(vtt || '')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/);

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (/^WEBVTT/i.test(line)) continue;
    if (/^(Kind|Language|NOTE|STYLE|REGION)\b/i.test(line)) continue;
    if (/^\d+$/.test(line)) continue; // cue 序号
    if (line.includes('-->')) continue; // 时间轴

    const text = line
      .replace(/<[^>]*>/g, '') // <c>、<00:00:01.000> 等内联标签
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) continue;
    if (out.length && out[out.length - 1] === text) continue; // 相邻重复
    out.push(text);
  }
  return out.join('\n').trim();
}

function listSubFiles(dir, stem) {
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.startsWith(stem) && /\.vtt$/i.test(f))
      .map((f) => path.join(dir, f));
  } catch {
    return [];
  }
}

function cleanSubFiles(dir, stem) {
  for (const f of listSubFiles(dir, stem)) {
    try {
      fs.unlinkSync(f);
    } catch {
      /* 忽略 */
    }
  }
}

/** 取 stderr 里最后一条 ERROR（yt-dlp 的报错格式是 ERROR: xxx） */
function lastErr(err) {
  const lines = String(err || '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const e = lines.filter((l) => /^ERROR/i.test(l)).pop() || lines.pop() || '';
  return e.replace(/^ERROR:\s*/i, '');
}

module.exports = { id, label, match, parseUrl, getInfo, getTranscript, downloadAudio, fileKey };
