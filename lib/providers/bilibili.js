// bilibili.js — B 站 provider（信息 / 字幕快路径 / 音频下载）
// 由原 lib/bilibili.js 迁移而来，包装成平台适配层的统一接口（见 ./index.js 顶部说明）
'use strict';

const fs = require('node:fs');
const crypto = require('node:crypto');
const { UA } = require('./common');

const REF = 'https://www.bilibili.com/';

const MIXIN_KEY_ENC_TAB = [
  46,47,18,2,53,8,23,32,15,50,10,31,58,3,45,35,27,43,5,49,33,9,42,19,29,28,14,39,12,38,41,13,37,48,7,16,24,55,40,61,26,17,0,1,60,51,30,4,22,25,54,21,56,59,6,63,57,62,11,36,20,34,44,52,
];

function md5(s) {
  return crypto.createHash('md5').update(s).digest('hex');
}
function getMixinKey(orig) {
  return MIXIN_KEY_ENC_TAB.map((n) => orig[n]).join('').slice(0, 32);
}
function wbiSign(params, key) {
  params.wts = Math.round(Date.now() / 1000);
  const q = Object.keys(params)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
    .join('&');
  return { ...params, w_rid: md5(q + key) };
}

async function getWbiKey() {
  const r = await fetch('https://api.bilibili.com/x/web-interface/nav', {
    headers: { 'User-Agent': UA },
  });
  const j = await r.json();
  const img = j.data.wbi_img.img_url.split('/').pop().split('.')[0];
  const sub = j.data.wbi_img.sub_url.split('/').pop().split('.')[0];
  return getMixinKey(img + sub);
}

/**
 * 读 JSON 接口。B 站风控时会返回 412 + HTML 页面，直接 r.json() 会抛出
 * 难以理解的 `Unexpected token '<'`，这里换成能看懂、可操作的提示。
 * 最常见的原因是「出口 IP 在境外」——即开着 VPN / 全局代理，详见 NETWORK.md。
 */
async function readJson(r, what) {
  const text = await r.text();
  try {
    return JSON.parse(text);
  } catch {
    const risk = r.status === 412 || r.status === 403;
    throw new Error(
      `${what}失败：B 站接口返回了非 JSON 内容（HTTP ${r.status}）` +
        (risk
          ? '。B 站会限制境外 / 代理 IP，最常见的原因是开着 VPN 或全局代理——请先关掉代理，或让 bilibili.com 等域名走直连（代理开「规则模式」分流）后重试，详见 NETWORK.md'
          : ''),
    );
  }
}

// ---------- 适配层接口 ----------

const id = 'bilibili';
const label = 'B 站';

/** 是否是 B 站链接（含裸 BV 号） */
function match(url) {
  const u = String(url || '');
  return /BV[0-9A-Za-z]{10}/.test(u) || /bilibili\.com|b23\.tv/i.test(u);
}

// 从任意 bilibili 链接里解析出 bvid 和分P号
async function parseUrl(rawUrl) {
  let url = String(rawUrl || '').trim();
  if (/^BV[0-9A-Za-z]{10}$/.test(url)) return { id: url, part: 1, url: `https://www.bilibili.com/video/${url}` };

  if (/^https?:\/\//i.test(url) && /b23\.tv|bilibili\.com\/video/i.test(url)) {
    // 短链需要跟随跳转
    if (/b23\.tv/i.test(url)) {
      try {
        const r = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' });
        url = r.url || url;
      } catch {
        /* 保持原样 */
      }
    }
    const m = url.match(/BV[0-9A-Za-z]{10}/);
    const p = new URL(url).searchParams.get('p');
    if (m) return { id: m[0], part: p ? parseInt(p, 10) : 1, url };
  }
  return null;
}

/**
 * 视频基本信息。同时把 ref.partKey / ref.partIndex 补齐（供后续字幕、音频、缓存命名使用）
 */
async function getInfo(ref) {
  const r = await fetch(
    `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(ref.id)}`,
    { headers: { 'User-Agent': UA } },
  );
  const j = await readJson(r, '获取视频信息');
  if (j.code !== 0) throw new Error(`获取视频信息失败：${j.message || j.code}`);
  const d = j.data;
  const parts = (d.pages || []).map((p) => ({ key: p.cid, label: p.part, duration: p.duration }));

  const want = Math.min(Math.max((ref.part || 1) - 1, 0), Math.max(parts.length - 1, 0));
  ref.part = want + 1;
  ref.partIndex = want;
  ref.partKey = parts[want] ? parts[want].key : d.cid;

  return {
    platform: id,
    platformLabel: label,
    ownerLabel: 'UP 主',
    id: ref.id,
    link: `https://www.bilibili.com/video/${ref.id}` + (ref.part > 1 ? `?p=${ref.part}` : ''),
    title: d.title,
    desc: d.desc || '',
    pic: d.pic,
    owner: d.owner ? d.owner.name : '',
    duration: d.duration,
    pubdate: d.pubdate,
    parts,
    aid: d.aid,
  };
}

// 快路径：尝试获取官方/AI 字幕。失败或没有字幕返回 null，交给语音识别兜底
async function getTranscript(ref, info) {
  try {
    const key = await getWbiKey();
    const signed = wbiSign({ aid: info.aid, cid: ref.partKey }, key);
    const qs = Object.entries(signed)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');
    const r = await fetch(`https://api.bilibili.com/x/player/wbi/v2?${qs}`, {
      headers: { 'User-Agent': UA, Referer: REF },
    });
    const j = await r.json();
    if (j.code !== 0) return null;
    const subs = (j.data && j.data.subtitle && j.data.subtitle.subtitles) || [];
    if (!subs.length) return null;
    // 优先中文
    const pick = subs.find((s) => /^zh/i.test(s.lan)) || subs[0];
    const sr = await fetch('https:' + pick.subtitle_url, { headers: { 'User-Agent': UA } });
    const sj = await sr.json();
    if (!sj.body || !sj.body.length) return null;
    return sj.body.map((b) => b.content).join('\n');
  } catch {
    return null;
  }
}

// 获取音频播放地址（DASH，无需登录）
async function getAudioUrl(bvid, cid) {
  const r = await fetch(
    `https://api.bilibili.com/x/player/playurl?bvid=${encodeURIComponent(bvid)}&cid=${cid}&platform=pc&fnval=16&fourk=1&qn=64`,
    { headers: { 'User-Agent': UA, Referer: REF } },
  );
  const j = await readJson(r, '获取播放地址');
  if (j.code !== 0) throw new Error(`获取播放地址失败：${j.message || j.code}`);
  const audio = j.data && j.data.dash && j.data.dash.audio;
  if (!audio || !audio.length) throw new Error('该视频没有可用的音频流');
  // 优先标准 m4a，其次选码率最高
  audio.sort(
    (a, b) =>
      (a.codecs === 'mp4a.40.2' ? 1 : 0) - (b.codecs === 'mp4a.40.2' ? 1 : 0) ||
      (b.bandwidth || 0) - (a.bandwidth || 0),
  );
  return audio[0].baseUrl;
}

/** 下载音频到临时目录，返回本地文件绝对路径 */
async function downloadAudio(ref, destDir) {
  const audioUrl = await getAudioUrl(ref.id, ref.partKey);
  const dest = require('node:path').join(destDir, `${fileKey(ref)}.m4s`);
  const r = await fetch(audioUrl, { headers: { 'User-Agent': UA, Referer: REF } });
  if (!r.ok) throw new Error(`音频下载失败（HTTP ${r.status}）`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length < 1024) throw new Error('音频下载失败：文件过小');
  fs.writeFileSync(dest, buf);
  return dest;
}

/** 缓存/临时文件唯一键。保持 `${bvid}_${cid}` 的旧命名，已有的转写缓存不失效 */
function fileKey(ref) {
  return `${ref.id}_${ref.partKey}`;
}

module.exports = { id, label, match, parseUrl, getInfo, getTranscript, downloadAudio, fileKey, UA };
