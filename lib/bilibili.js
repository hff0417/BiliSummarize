// bilibili.js — 视频信息获取 / 字幕快路径 / 音频下载
'use strict';

const fs = require('node:fs');
const crypto = require('node:crypto');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
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

// 从任意 bilibili 链接里解析出 bvid 和分P号
async function parseUrl(rawUrl) {
  let url = String(rawUrl || '').trim();
  if (/^BV[0-9A-Za-z]{10}$/.test(url)) return { bvid: url, p: 1 };

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
    if (m) return { bvid: m[0], p: p ? parseInt(p, 10) : 1 };
  }
  return { bvid: null, p: 1 };
}

// 视频基本信息（标题、封面、UP主、分P 等）
async function getVideoInfo(bvid) {
  const r = await fetch(
    `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`,
    { headers: { 'User-Agent': UA } },
  );
  const j = await r.json();
  if (j.code !== 0) throw new Error(`获取视频信息失败：${j.message || j.code}`);
  const d = j.data;
  return {
    bvid,
    aid: d.aid,
    title: d.title,
    desc: d.desc || '',
    pic: d.pic,
    owner: d.owner ? d.owner.name : '',
    duration: d.duration,
    pubdate: d.pubdate,
    pages: (d.pages || []).map((p) => ({ cid: p.cid, part: p.part, duration: p.duration })),
  };
}

// 快路径：尝试获取官方/AI 字幕。失败或没有字幕返回 null，交给语音识别兜底
async function getSubtitle(aid, cid) {
  try {
    const key = await getWbiKey();
    const signed = wbiSign({ aid, cid }, key);
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
  const j = await r.json();
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

// 下载音频到本地文件
async function downloadAudio(url, dest) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Referer: REF } });
  if (!r.ok) throw new Error(`音频下载失败（HTTP ${r.status}）`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length < 1024) throw new Error('音频下载失败：文件过小');
  fs.writeFileSync(dest, buf);
  return buf.length;
}

module.exports = { parseUrl, getVideoInfo, getSubtitle, getAudioUrl, downloadAudio, UA };
