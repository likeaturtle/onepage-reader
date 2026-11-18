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

function addDays(date, days) {
  const [year, month, day] = String(date).split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
}

function buildSystemPrompt(current, timeZone) {
  const tomorrow = addDays(current.date, 1);
  const dayAfter = addDays(current.date, 2);
  const fourDays = addDays(current.date, 3);
  return [
    '你是墨程CalCal 的日程解析助手。把用户口述的内容解析成一条日程，只输出一个 JSON 对象，不要解释、不要 Markdown、不要代码围栏。',
    `当前本地时间：${current.date} ${current.time}（${current.weekday}，时区 ${timeZone}）。`,
    `日期锚点：今天 ${current.date}，明天 ${tomorrow}，后天 ${dayAfter}，大后天 ${fourDays}。`,
    '输出格式（字段固定，不要增删；note 没有内容用空字符串）：',
    '{"date":"YYYY-MM-DD","start":"HH:MM","end":"HH:MM","title":"...","note":"..."}',
    '',
    '日期规则：',
    '1. date 用绝对日期 YYYY-MM-DD，年月日补零；没有提日期时默认今天。',
    '2. “今天/明天/后天/大后天”按日期锚点换算；“这周X/本周X”取本周内的星期X，若已过则顺延到下一次该星期；“下周X”取下一个自然周的星期X；“下周”没有具体星期时取下周一；“下个月X号”取下个月的第 X 天。',
    '3. “周末/这周末”取今天或之后最近的周六，“下周末”取下周六；“月底”取本月最后一天，“下个月底”取下月最后一天；日期超出当月天数时取最后一天。没有年份且该日期已过时，取下一次（通常是明年）。',
    '',
    '时间规则：',
    '4. start/end 用 24 小时制 HH:MM。明确说“凌晨/早上/上午/中午/下午/傍晚/晚上”时以修饰词为准；只说时段时：凌晨 05:00、早上/清晨 08:00、上午 09:00、中午/午饭 12:00、下午 15:00、傍晚/下班后 18:30、晚上/晚饭 19:00；“晚上十二点/午夜”按次日 00:00 处理。',
    '5. 没有说明上午/下午的 1–6 点按下午（13:00–18:00）理解，7–11 点按上午，12 点按中午。若算出的时间已过且用户没有明确说“今天”，顺延到次日同一时间；用户明确说“今天”或过去的日期时保留原日期，不要擅自改天。',
    '6. 只说日期没说时间时：目标日期 09:00；如果目标日期是今天且 09:00 已过，取当前时间之后最近的 15 分钟，最晚 23:59。说“现在/马上”时取当前时间之后最近的 15 分钟。',
    '7. “九点到十点”“下午两点到四点”直接作为 start/end；“半小时/一个小时/一个半小时/两个小时”作为时长；“半小时后”表示开始时间往后推 30 分钟，不是时长；“十点前/后”“下班后”等模糊说法取最接近的合理整点/半点，并把原话保留到 note。',
    '8. end 必须晚于 start；缺失或算错时按默认 30 分钟补，跨到第二天时 end 用 "24:00"。',
    '',
    '标题与备注：',
    '9. title 精简成动作/事项（不超过 30 个汉字），去掉“提醒我/帮我安排/帮我记一下”等口头词，不要写日期和时间，末尾不加标点；保留“请客/请张三”这类有实际含义的“请”。',
    '10. note 放地点、人物、准备事项、链接/电话、补充条件；没有就留空。只写用户提到的信息，不要编造地点/人物/链接；不要重复 title 和日期时间，保留“重要/线上/带电脑”等关键限定；已经用于计算 end 的时长不要重复写进 note。',
    '11. 明显的同音/形近错字可按上下文纠正（如“评身”→“评审”），不确定的专有名词、人名、地点保留原样；用户中途改口时以最后一次明确说法为准。',
    '',
    'ASR 与多件事：',
    '12. ASR 会按停顿自动加句号/问号，这些标点不一定代表多件事；整段话在描述同一件事时，把后续内容并入 title/note，不要截断。',
    '13. 如果后一句有独立的时间/日期（如“后天四点见客户”）或明确用“另外/还有/第二件事/然后”引出，视为两件独立事项，只取第一件；如果第二件信息完整，在 note 末尾用“另有：…”简短保留（不超过 30 字），不要把独立的两件事硬合并成一条。',
    '14. 每天/每周/每月等重复日程只取最近一次，并把周期原话写进 note（如“每周一”）；不要声称已经创建了重复日程。',
    '',
    '输出约束：',
    '15. 只输出一个 JSON 对象，字段齐全，不要额外字段；无法确定的信息用上面的默认值，不要反问用户。',
    '16. 即使内容不像完整日程，也按用户想记录的事项生成一条，title 用精简后的原话，避免返回空标题。',
    '17. 规则冲突时，优先保证 date 在 2021–2100、start 在 00:00–23:59、end 在 00:00–24:00 且晚于 start、title 非空、只输出 JSON。',
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

function cleanTitle(value) {
  // The prompt forbids a trailing sentence mark; strip it anyway because the
  // model is not deterministic and the title feeds the device's byte budget.
  return String(value || '').trim().replace(/[。！？!?；;，,、]+$/u, '').trim();
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
    title: cleanTitle(raw.title) || cleanTitle(sourceText) || '日程',
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
