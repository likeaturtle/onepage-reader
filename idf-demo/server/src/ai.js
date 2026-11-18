'use strict';

const { httpError } = require('./http-error');
const { normalizeEvent } = require('./event-rules');

/*
 * DeepSeek voice pipeline.
 *
 * The mini program records 16-bit mono PCM and posts it as base64; this module
 * adds a WAV header and forwards it to DeepSeek ASR. The recognized sentence is
 * then parsed into an event draft with the chat model (JSON mode). The API key
 * stays on the server: it is never shipped in the mini program.
 *
 * ASR docs: https://api-docs.deepseek.com/zh-cn/guides/asr
 */

const ASR_PATH = '/v1/tools/asr';
const CHAT_PATH = '/chat/completions';
const ASR_SAMPLE_RATES = new Set([8000, 16000, 22050, 24000, 32000, 44100, 48000]);
const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
const ASR_MAX_SECONDS = 120;
const MAX_TEXT_CHARS = 500;

function requireKey(config) {
  if (!config || !config.deepseekApiKey) {
    throw httpError(503, '服务端未配置 DEEPSEEK_API_KEY，语音日程暂不可用');
  }
}

function apiUrl(config, path) {
  const base = String(config.deepseekBaseUrl || 'https://api.deepseek.com').replace(/\/+$/, '');
  return base + path;
}

function doFetch(config, url, options) {
  const impl = config && typeof config.fetchImpl === 'function'
    ? config.fetchImpl
    : globalThis.fetch;
  if (typeof impl !== 'function') {
    throw httpError(500, '当前 Node 版本不支持 fetch，请升级到 Node 22');
  }
  return impl(url, options);
}

function timeoutOf(config) {
  const value = Number(config && config.deepseekTimeoutMs);
  return Number.isFinite(value) && value > 0 ? value : 30000;
}

function isTimeout(err) {
  return Boolean(err) && (err.name === 'TimeoutError' || err.name === 'AbortError');
}

async function readJson(response) {
  try {
    return await response.json();
  } catch (_) {
    return null;
  }
}

function buildWav(pcm, options = {}) {
  if (!Buffer.isBuffer(pcm) || pcm.length === 0) {
    throw httpError(400, '录音内容为空，请重新录制');
  }
  const sampleRate = Number(options.sampleRate || 16000);
  const channels = Number(options.channels || 1);
  const bitsPerSample = Number(options.bitsPerSample || 16);
  if (!ASR_SAMPLE_RATES.has(sampleRate)) {
    throw httpError(400, '录音采样率不支持，应为 8000–48000 Hz');
  }
  if (channels !== 1 && channels !== 2) throw httpError(400, '录音声道数必须为 1 或 2');
  if (bitsPerSample !== 16) throw httpError(400, '录音位深必须为 16 位');
  const blockAlign = channels * bitsPerSample / 8;
  if (pcm.length % blockAlign !== 0) {
    throw httpError(400, '录音数据不完整，请重新录制');
  }
  // DeepSeek ASR accepts at most 120 seconds per request.
  if (pcm.length / (sampleRate * blockAlign) > ASR_MAX_SECONDS) {
    throw httpError(413, `录音不能超过 ${ASR_MAX_SECONDS} 秒`);
  }

  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * blockAlign, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function decodeBase64(data) {
  const clean = String(data || '').replace(/^data:audio\/[\w.+-]+;base64,/, '');
  if (!clean || !/^[A-Za-z0-9+/]+={0,2}$/.test(clean) || clean.length % 4 !== 0) {
    throw httpError(400, '录音数据不是合法的 base64');
  }
  return Buffer.from(clean, 'base64');
}

/**
 * Accept either an already encoded WAV/Ogg file (the recorder can return one on
 * some platforms) or headerless PCM, which gets a WAV header. DeepSeek rejects
 * every other container.
 */
function prepareAudio(audio) {
  const raw = decodeBase64(audio && audio.data);
  if (raw.length === 0) throw httpError(400, '录音内容为空，请重新录制');
  if (raw.length > MAX_AUDIO_BYTES) {
    throw httpError(413, '录音文件不能超过 8 MB，请缩短录音');
  }
  if (raw.length >= 12 && raw.toString('ascii', 0, 4) === 'RIFF' &&
      raw.toString('ascii', 8, 12) === 'WAVE') {
    return raw;
  }
  if (raw.length >= 4 && raw.toString('ascii', 0, 4) === 'OggS') return raw;
  return buildWav(raw, {
    sampleRate: audio.sampleRate,
    channels: audio.channels,
    bitsPerSample: audio.bitsPerSample,
  });
}

function asrError(status) {
  if (status === 400) return httpError(400, '录音格式无法识别，请重新录制');
  if (status === 408 || status === 504) return httpError(504, '语音识别超时，请稍后重试');
  if (status === 413) return httpError(413, '录音文件不能超过 8 MB，请缩短录音');
  if (status === 429) return httpError(429, '语音识别请求太频繁，请稍后再试');
  if (status === 503) return httpError(503, '语音识别服务繁忙，请稍后再试');
  if (status === 401 || status === 403) {
    return httpError(500, '服务端 DeepSeek API Key 无效，请联系管理员');
  }
  return httpError(502, `语音识别服务返回异常（${status}）`);
}

async function transcribe(config, audio) {
  requireKey(config);
  const wav = prepareAudio(audio);
  const form = new FormData();
  form.append('file', new Blob([wav], { type: 'audio/wav' }), 'speech.wav');

  let response;
  try {
    response = await doFetch(config, apiUrl(config, ASR_PATH), {
      method: 'POST',
      headers: { authorization: `Bearer ${config.deepseekApiKey}` },
      body: form,
      signal: AbortSignal.timeout(timeoutOf(config)),
    });
  } catch (err) {
    if (isTimeout(err)) throw httpError(504, '语音识别超时，请稍后重试');
    throw httpError(502, '语音识别服务连接失败，请检查网络后重试');
  }

  const data = await readJson(response);
  if (!response.ok) throw asrError(response.status);
  const text = data && typeof data.text === 'string' ? data.text.trim().slice(0, 2000) : '';
  if (!text) throw httpError(422, '没有识别到语音内容，请再说一次');
  return {
    text,
    durationMs: Number(data.duration_ms) || 0,
    requestId: typeof data.request_id === 'string' ? data.request_id : '',
  };
}

function localNow(now, timeZone) {
  let parts;
  try {
    parts = new Intl.DateTimeFormat('zh-CN', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'long',
      hourCycle: 'h23',
    }).formatToParts(now);
  } catch (_) {
    throw httpError(500, '服务端时区配置不正确，请检查 SCHEDULE_TIMEZONE');
  }
  const value = {};
  for (const part of parts) {
    if (part.type !== 'literal') value[part.type] = part.value;
  }
  return {
    date: `${value.year}-${value.month}-${value.day}`,
    time: `${value.hour}:${value.minute}`,
    weekday: value.weekday || '',
  };
}

function buildSystemPrompt(current, timeZone) {
  return [
    '你是墨程CalCal 的日程解析助手。把用户的一句话解析成一条日程，只输出一个 JSON 对象，不要输出解释或 Markdown。',
    `当前本地时间：${current.date} ${current.time}（${current.weekday}，时区 ${timeZone}）。`,
    '输出格式：',
    '{"date":"YYYY-MM-DD","start":"HH:MM","end":"HH:MM","title":"...","note":"..."}',
    '规则：',
    '1. date 必须是绝对日期，按当前时间换算“今天/明天/后天/这周X/下周X/下个月X号”等相对说法。',
    '2. start 使用 24 小时制。只说“上午/下午/晚上”时用合理时刻（上午 9:00、下午 15:00、晚上 19:00）；完全没提时间时，从当前时间往后取最近的 15 分钟。',
    '3. end 必须晚于 start。提到“半小时/一小时/两小时”等按该时长；没提时长默认 30 分钟；跨到第二天时 end 用 "24:00"。',
    '4. title 是简短标题（不超过 30 个汉字），不要把日期或时间写进标题。',
    '5. note 放地点、参与人、补充说明；没有就填空字符串。',
    '6. 如果用户说了多件事，只取第一件。',
  ].join('\n');
}

function stripFence(value) {
  const text = String(value || '').trim();
  const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(text);
  return match ? match[1].trim() : text;
}

function parseJsonObject(content) {
  const text = stripFence(content);
  try {
    return JSON.parse(text);
  } catch (_) {
    // JSON mode should be pure JSON, but tolerate a short prefix/suffix.
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch (_) {
        // fall through to the shared error below
      }
    }
    throw httpError(502, 'AI 返回的日程格式不正确，请重试');
  }
}

function parseDraft(content, sourceText, current) {
  const raw = parseJsonObject(content);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw httpError(502, 'AI 返回的日程格式不正确，请重试');
  }
  const candidate = {
    date: raw.date,
    start: raw.start,
    end: raw.end,
    // The model occasionally drops the title; the spoken sentence is a better
    // fallback than rejecting an otherwise usable date/time.
    title: String(raw.title || '').trim() || sourceText,
    note: raw.note == null ? '' : String(raw.note),
  };
  try {
    const event = normalizeEvent(candidate, { defaultEndMinutes: 30 });
    return {
      date: event.date,
      start: event.start,
      end: event.end,
      title: event.title,
      note: event.note,
    };
  } catch (_) {
    const hint = current ? `（当前是 ${current.date} ${current.time}）` : '';
    throw httpError(422, `AI 没能理解这条日程${hint}，请把日期和时间说得更具体一些`);
  }
}

function chatError(status) {
  if (status === 401 || status === 403) {
    return httpError(500, '服务端 DeepSeek API Key 无效，请联系管理员');
  }
  if (status === 429) return httpError(429, 'AI 解析请求太频繁，请稍后再试');
  if (status === 408 || status === 504) return httpError(504, 'AI 解析超时，请稍后重试');
  if (status >= 500) return httpError(503, 'AI 服务繁忙，请稍后重试');
  return httpError(502, 'AI 解析请求失败，请重试');
}

async function parseSchedule(config, text, now = new Date()) {
  requireKey(config);
  const sourceText = String(text || '').trim();
  if (!sourceText) throw httpError(400, '日程内容不能为空');
  if (sourceText.length > MAX_TEXT_CHARS) {
    throw httpError(400, `日程内容最多 ${MAX_TEXT_CHARS} 字`);
  }

  const timeZone = config.scheduleTimeZone || 'Asia/Shanghai';
  const current = localNow(now, timeZone);
  let response;
  try {
    response = await doFetch(config, apiUrl(config, CHAT_PATH), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.deepseekApiKey}`,
      },
      body: JSON.stringify({
        model: config.deepseekModel || 'deepseek-flash',
        messages: [
          { role: 'system', content: buildSystemPrompt(current, timeZone) },
          { role: 'user', content: sourceText },
        ],
        // This is a short extraction task; thinking mode would spend tokens on
        // reasoning and can leave `content` empty under a small max_tokens.
        thinking: { type: 'disabled' },
        response_format: { type: 'json_object' },
        temperature: 0,
        max_tokens: 500,
        stream: false,
      }),
      signal: AbortSignal.timeout(timeoutOf(config)),
    });
  } catch (err) {
    if (isTimeout(err)) throw httpError(504, 'AI 解析超时，请稍后重试');
    throw httpError(502, 'AI 服务连接失败，请检查网络后重试');
  }

  const data = await readJson(response);
  if (!response.ok) throw chatError(response.status);
  const content = data && data.choices && data.choices[0] &&
    data.choices[0].message ? data.choices[0].message.content : '';
  if (typeof content !== 'string' || !content.trim()) {
    throw httpError(502, 'AI 没有返回日程内容，请重试');
  }
  return parseDraft(content, sourceText, current);
}

module.exports = {
  prepareAudio,
  buildWav,
  transcribe,
  parseSchedule,
  localNow,
};
