// transcribe.js — 封装 whisper-cli（Vulkan GPU 加速）进行语音转写
'use strict';

const path = require('node:path');
const { spawn } = require('node:child_process');

/**
 * 调用 whisper-cli 把 wav 转成文本。
 * 默认抓取 stdout（带 [时间戳]），配置 withTimestamps:false 时输出纯文本。
 * @param {string} wavPath 16kHz 单声道 wav
 * @param {string} lang 'zh' | 'en' | 'auto'
 * @param {object} cfg { whisperCli, whisperModel, whisperThreads, withTimestamps }
 */
function transcribe(wavPath, lang, cfg) {
  return new Promise((resolve, reject) => {
    const cli = path.resolve(cfg.whisperCli);
    const args = [
      '-m', path.resolve(cfg.whisperModel),
      '-f', wavPath,
      '-l', lang || 'auto',
      '-t', String(cfg.whisperThreads || 8),
      '--no-prints',
    ];
    // 默认输出带时间戳（便于总结引用时间点）；config 里 withTimestamps:false 则加 -nt 输出纯文本
    if (!cfg.withTimestamps) args.push('-nt');

    const child = spawn(cli, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let out = '';
    let errBuf = '';
    child.stdout.on('data', (d) => (out += d.toString()));
    child.stderr.on('data', (d) => (errBuf += d.toString()));

    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('语音识别超时（超过 10 分钟）'));
    }, 10 * 60 * 1000);

    child.on('error', (e) => {
      clearTimeout(timer);
      if (e.code === 'ENOENT') {
        reject(new Error(`未找到 whisper-cli，请检查 config.json 里的 whisperCli 路径：${cli}`));
      } else {
        reject(new Error('启动 whisper 失败：' + e.message));
      }
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      const text = out.replace(/\r/g, '').trim();
      if (code === 0 && text) return resolve(text);
      const tail = errBuf
        .split('\n')
        .filter((l) => l.trim())
        .slice(-2)
        .join(' ');
      reject(new Error(`语音识别失败（exit ${code}）${tail ? '：' + tail : ''}`));
    });
  });
}

module.exports = { transcribe };
