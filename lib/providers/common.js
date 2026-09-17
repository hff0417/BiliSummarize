// common.js — 平台适配层公共部分（统一 UA、封面代理请求头、前端信息视图）
'use strict';

// 伪装成常见浏览器，B 站与 YouTube 都吃这一套
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// 封面图防盗链规则：不同站点的 Referer 要求不同
const PIC_RULES = [
  { host: /(^|\.)(ytimg\.com|ggpht\.com|googleusercontent\.com)$/i, referer: null }, // YouTube 不校验 Referer
  { host: /(^|\.)(bilibili\.com|hdslb\.com)$/i, referer: 'https://www.bilibili.com/' }, // B 站图片必须带 Referer
];

/** 按封面图域名给出代理请求头（Referer 给错反而会被拒） */
function picHeaders(url) {
  const headers = { 'User-Agent': UA };
  try {
    const { hostname } = new URL(url);
    const rule = PIC_RULES.find((r) => r.host.test(hostname));
    if (rule && rule.referer) headers.Referer = rule.referer;
  } catch {
    /* 非法 URL：只带 UA */
  }
  return headers;
}

/**
 * 把 provider.getInfo() 的结果转成前端展示用的 infoView（与平台无关）。
 * 分P 相关字段统一在这里算，各 provider 不用各写一遍。
 * @param {object} info provider.getInfo() 返回的统一信息
 * @param {object} ref  provider.parseUrl() 返回（含 part 序号，getInfo 后 partKey 已补齐）
 */
function buildInfoView(info, ref) {
  const parts = Array.isArray(info.parts) && info.parts.length ? info.parts : [{ label: '' }];
  const want = Math.min(Math.max((ref && ref.part ? ref.part : 1) - 1, 0), parts.length - 1);
  const part = parts[want] || {};
  return {
    platform: info.platform,
    platformLabel: info.platformLabel,
    ownerLabel: info.ownerLabel,
    link: info.link,
    id: info.id,
    title: info.title,
    desc: info.desc,
    pic: info.pic,
    owner: info.owner,
    duration: info.duration,
    pubdate: info.pubdate,
    part: part.label || '',
    partIndex: want + 1,
    partCount: parts.length,
  };
}

module.exports = { UA, picHeaders, buildInfoView };
