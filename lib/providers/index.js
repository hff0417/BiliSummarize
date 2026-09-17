// index.js — 平台适配层注册表：按 URL 路由到对应 provider
//
// provider 统一接口（新增平台只要实现这些，server.js / 前端都不用改）：
//   id            平台标识，用于临时文件与缓存前缀（'bilibili' | 'youtube'）
//   label         平台中文名（'B 站' | 'YouTube'），用于报错提示
//   match(url)    → boolean，是否是本平台链接
//   parseUrl(url) → { id, part, url } | null   归一化标识；不支持返回 null
//   getInfo(ref, cfg)
//                 → info 统一信息对象，并**负责补齐 ref.partKey / ref.partIndex**：
//                   统一字段：platform, platformLabel, ownerLabel, id, link, title, desc,
//                             pic, owner, duration(秒), pubdate(unix秒), parts[]
//                           parts[] 元素：{ key, label, duration }（key 即 partKey）
//                   平台私有字段可另加（B 站加 aid；YouTube 加 subtitleLangs）
//   getTranscript(ref, info, cfg)
//                 → string | null   字幕快路径；没有字幕返回 null，由 GPU 转写兜底
//   downloadAudio(ref, destDir, cfg)
//                 → 本地音频文件绝对路径（下载方式各平台自定：直链下载 / 外部工具子进程）
//   fileKey(ref)  → 缓存与临时文件名用的唯一键（不含扩展名）
//
// 注意：getInfo 之外的接口都在 getInfo 之后调用，此时 ref.partKey 已可用。
'use strict';

const bilibili = require('./bilibili');
const youtube = require('./youtube');
const { UA, picHeaders, buildInfoView } = require('./common');

// 顺序无影响（各平台链接特征不重叠），仅影响报错时列举的顺序
const PROVIDERS = [bilibili, youtube];

/** 按 URL 找到对应 provider；都不匹配返回 null */
function resolve(url) {
  const u = String(url || '').trim();
  if (!u) return null;
  return PROVIDERS.find((p) => p.match(u)) || null;
}

/** 已支持的平台列表（报错提示用） */
function supportedLabels() {
  return PROVIDERS.map((p) => p.label);
}

module.exports = { resolve, supportedLabels, PROVIDERS, UA, picHeaders, buildInfoView };
