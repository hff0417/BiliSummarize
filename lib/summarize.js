// summarize.js — 调用本地 LM Studio 的 Qwen 模型生成总结 / 回答追问
'use strict';

// 根据视频时长给出要点条数建议
function pointCountByDuration(sec) {
  if (!sec) return 8;
  const min = sec / 60;
  if (min >= 20) return 12;
  if (min >= 10) return 9;
  if (min >= 5) return 7;
  return 6;
}

function buildPrompt(transcript, info) {
  const cap = 60000;
  let text = transcript;
  let note = '';
  if (text.length > cap) {
    text = text.slice(0, cap);
    note = `\n（注：转写文本过长，已截取前 ${cap} 字，可能遗漏部分内容）`;
  }
  const min = info.duration ? Math.round(info.duration / 60) : 0;
  const n = pointCountByDuration(info.duration);

  return `你是一名专业的视频内容总结助手。下面是一段 ${info.platformLabel || 'B 站'}视频的语音转写文本${note}。
视频标题：《${info.title}》
${info.ownerLabel || 'UP 主'}：${info.owner || '未知'}
视频时长：约 ${min || '?'} 分钟

请先通读理解视频内容，然后进行**详细充实**的总结，最后**只输出一个 JSON 对象**（不要 markdown 代码块、不要任何解释文字、不要多余逗号），结构如下：
{
  "overview": "用 4-6 句话概括视频的核心内容、主题与讲述思路",
  "points": ["要点1", "要点2", "要点3"],
  "keywords": ["关键词1", "关键词2"],
  "conclusion": "用 1-2 句话给出视频的结论或最值得记住的信息"
}

要求：
- points 给出 ${n} 条左右，每条**1-2 句话**，要具体、有信息量：包含关键细节（型号、数字、价格、结论、对比、前后变化等），不要只说空话
- points 按内容重要性排序，覆盖视频的主要环节（如讲解、演示、测试、结论等）
- keywords 给出 6-10 个关键名词或术语
- 全部用简体中文输出
- 转写来自语音识别，可能有少量错别字，请结合上下文理解真实含义，不要照抄错字
- 转写文本中的 [时间戳] 标记可以帮助你定位内容位置，若某条要点很适合标注时间点（如「在 03:20 提到…」），可酌情附上，但不是必须`;
}

// 生成系统提示词（视频上下文 + 回答规则，多轮对话中保持不变）
function buildSystemPrompt(transcript, info, summary) {
  const cap = 40000;
  let text = transcript;
  if (text.length > cap) text = text.slice(0, cap);
  let ctx = '';
  if (summary && summary.overview) {
    ctx += `视频内容概要：${summary.overview}\n\n`;
  }
  return `你是一名全能知识问答助手，现在配合一段 ${info.platformLabel || 'B 站'}视频进行答疑。视频信息是重要的参考资料，但你不应只局限于视频内容。

${ctx}视频标题：《${info.title}》${info.owner ? '\n' + (info.ownerLabel || 'UP 主') + '：' + info.owner : ''}
视频语音转写文本（供参考）：
"""
${text}
"""

回答规则：
1. 如果问题与视频内容相关，优先结合视频信息作答，尽量具体（可引用数字、型号、结论等），必要时注明这些信息来自视频；
2. 如果问题是超出视频内容的一般性、横向或发散问题（例如背景知识、技术原理、行业对比、选购建议、延伸思考），请结合你自己的知识完整地回答，**不要**以「视频中未提及」来回避或拒绝；
3. 两者结合更好：先把问题本身答清楚，再补充「视频里相关的内容」（若有）；
4. 这是一段多轮对话，请保持上下文连贯，可以引用之前讨论过的内容，不要重复已经说过的话；
5. 用简体中文，清晰、有条理，长度适中。`;
}

// 从模型输出中稳妥地解析 JSON
function parseSummary(content) {
  let text = String(content || '').trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  const s = text.indexOf('{');
  const e = text.lastIndexOf('}');
  if (s >= 0 && e > s) text = text.slice(s, e + 1);
  try {
    const obj = JSON.parse(text);
    return {
      overview: String(obj.overview || '').trim(),
      points: (Array.isArray(obj.points) ? obj.points : []).map((p) => String(p).trim()).filter(Boolean),
      keywords: (Array.isArray(obj.keywords) ? obj.keywords : []).map((k) => String(k).trim()).filter(Boolean),
      conclusion: String(obj.conclusion || '').trim(),
    };
  } catch {
    // 解析失败就整段当概述展示，不让用户丢内容
    return { overview: text, points: [], keywords: [], conclusion: '' };
  }
}

function lmUrl(cfg) {
  return (cfg.lmStudioUrl || 'http://localhost:1234/v1').replace(/\/+$/, '') + '/chat/completions';
}

/**
 * 调用 LM Studio OpenAI 兼容接口生成总结
 * @param {string} transcript
 * @param {object} info 视频信息（含 title / owner / duration）
 * @param {object} cfg { lmStudioUrl, lmStudioModel }
 */
async function summarize(transcript, info, cfg) {
  const url = lmUrl(cfg);
  const body = {
    model: cfg.lmStudioModel || 'qwen/qwen3.6-35b-a3b',
    messages: [{ role: 'user', content: buildPrompt(transcript, info) }],
    temperature: 0.3,
    max_tokens: 8192,
    stream: false,
  };

  const j = await callLm(url, body, '总结');
  let content = j.choices && j.choices[0] && j.choices[0].message ? j.choices[0].message.content || '' : '';

  // 思考模式可能把 max_tokens 吃光导致 content 为空，加大 token 重试一次
  if (!content.trim()) {
    body.max_tokens = 20000;
    const j2 = await callLm(url, body, '总结');
    content = (j2.choices && j2.choices[0] && j2.choices[0].message && j2.choices[0].message.content) || '';
  }
  if (!content.trim()) throw new Error('本地模型未返回有效总结内容，请检查模型上下文设置或换个模型');

  return parseSummary(content);
}

/**
 * 针对视频内容回答追问（支持多轮对话）。
 * @param {string} transcript
 * @param {object} info
 * @param {object} summary 可选的已有总结（用于提供上下文）
 * @param {Array<{role:string,content:string}>} history 之前的对话轮次
 * @param {string} question 当前问题
 * @param {object} cfg
 * @param {(delta:string)=>void} [onToken] 提供则流式输出；不提供则返回完整文本
 * @returns {Promise<string>}
 */
async function ask(transcript, info, summary, history, question, cfg, onToken) {
  const url = lmUrl(cfg);
  const messages = [{ role: 'system', content: buildSystemPrompt(transcript, info, summary) }];
  for (const turn of history || []) {
    if (turn && turn.role && turn.content) messages.push({ role: turn.role, content: turn.content });
  }
  messages.push({ role: 'user', content: question });

  const body = {
    model: cfg.lmStudioModel || 'qwen/qwen3.6-35b-a3b',
    messages,
    temperature: 0.4,
    max_tokens: 2048,
    stream: !!onToken,
  };

  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5 * 60 * 1000),
  });
  if (!r.ok) {
    throw new Error(`本地模型接口返回错误（HTTP ${r.status}）`);
  }

  if (!onToken) {
    const j = await r.json();
    return (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content || '').trim();
  }

  // 流式：转发每段增量
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let text = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') continue;
      try {
        const j = JSON.parse(payload);
        const delta = j.choices && j.choices[0] && j.choices[0].delta ? j.choices[0].delta.content : '';
        if (delta) {
          text += delta;
          onToken(delta);
        }
      } catch {
        /* 忽略无法解析的行 */
      }
    }
  }
  return text.trim();
}

// 统一的请求封装：处理连接/超时/HTTP 错误
async function callLm(url, body, what) {
  let r;
  try {
    r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10 * 60 * 1000), // 10 分钟超时，防止卡死占用队列
    });
  } catch (e) {
    if (e.name === 'TimeoutError' || e.name === 'AbortError') {
      throw new Error(`${what}超时（超过 10 分钟）。请确认 LM Studio 未处于思考模式，或换更快的模型。`);
    }
    throw new Error('无法连接本地大模型（LM Studio）。请确认 LM Studio 已启动并已加载模型，然后重试。' + (e.cause ? '（' + e.cause.code + '）' : ''));
  }
  if (!r.ok) {
    throw new Error(`本地模型接口返回错误（HTTP ${r.status}）。请确认 LM Studio 已加载「${body.model}」模型。`);
  }
  return r.json();
}

module.exports = { summarize, ask, parseSummary };
