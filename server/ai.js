// Optional AI summary for the coaching report, local only (AI_ENABLED=1). The browser sends
// facts that the app already computed; the model only rewrites them as advice. Any sentence
// or focus item containing a number that is not in the facts is dropped before replying.
// Speaks the OpenAI-compatible Chat Completions API, so Ollama, LM Studio, OpenRouter,
// Gemini's compatibility endpoint and OpenAI itself work by changing AI_BASE_URL/AI_MODEL.
import {RiotError} from './riot.js';

const DEFAULT_BASE_URL = 'http://127.0.0.1:11434/v1';
const DEFAULT_MODEL = 'qwen3:4b-instruct';
const REQUEST_TIMEOUT_MS = 90000;
const MAX_FACTS_CHARS = 16000;
const MAX_DEPTH = 4;
const MAX_ITEMS = 30;
const MAX_TEXT = 500;
const MAX_FOCUS = 3;
// Counts like "2 habits" or "5 games" are fine even when they are not in the facts.
const SMALL_NUMBER = 10;
const RIOT_ID = /[^\s#"]{2,}#[A-Za-z0-9]{2,5}\b/;

const aiError = (code, message, status) => new RiotError(code, message, status);

export function aiConfig(env = {}) {
  const raw =
    typeof env.AI_BASE_URL === 'string' && env.AI_BASE_URL.trim() ? env.AI_BASE_URL.trim() : DEFAULT_BASE_URL;
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw aiError('AI_CONFIG', 'AI_BASE_URL không hợp lệ.', 500);
  }
  if (!['http:', 'https:'].includes(url.protocol))
    throw aiError('AI_CONFIG', 'AI_BASE_URL cần dùng http hoặc https.', 500);
  return {
    baseUrl: url.href.replace(/\/+$/, ''),
    model: typeof env.AI_MODEL === 'string' && env.AI_MODEL.trim() ? env.AI_MODEL.trim() : DEFAULT_MODEL,
    apiKey: typeof env.AI_API_KEY === 'string' ? env.AI_API_KEY.trim() : '',
    reasoningEffort: reasoningEffort(env.AI_REASONING_EFFORT),
  };
}

// Hybrid reasoning models (qwen3:8b) think before answering unless told not to, which is
// several times slower. Only sent when set, because some providers reject the parameter.
const REASONING_EFFORTS = ['none', 'low', 'medium', 'high'];
function reasoningEffort(value) {
  const effort = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (effort && !REASONING_EFFORTS.includes(effort))
    throw aiError('AI_CONFIG', 'AI_REASONING_EFFORT cần là none, low, medium hoặc high.', 500);
  return effort;
}

export function validateFacts(facts) {
  const invalid = () => aiError('AI_INVALID_FACTS', 'Dữ liệu gửi cho AI không hợp lệ.', 400);
  const check = (value, depth) => {
    if (depth > MAX_DEPTH) throw invalid();
    if (typeof value === 'string') {
      // Riot IDs of the player or others are never sent to a model.
      if (value.length > MAX_TEXT || RIOT_ID.test(value)) throw invalid();
      return;
    }
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw invalid();
      return;
    }
    if (typeof value === 'boolean' || value === null) return;
    const entries = Array.isArray(value)
      ? value
      : value && typeof value === 'object'
        ? Object.values(value)
        : null;
    if (!entries || entries.length > MAX_ITEMS) throw invalid();
    for (const entry of entries) check(entry, depth + 1);
  };
  if (!facts || typeof facts !== 'object' || Array.isArray(facts)) throw invalid();
  check(facts, 0);
  if (JSON.stringify(facts).length > MAX_FACTS_CHARS) throw invalid();
  return facts;
}

const NUMBER = /\d+(?:[.,]\d+)*/g;
const variants = token => [
  token,
  token.replace(/,/g, '.'),
  token.replace(/\./g, ','),
  token.replace(/[.,]/g, ''),
];

// Each number with whether it is written as a percentage ("55%", "55 %").
function numbersIn(text) {
  const source = String(text);
  return [...source.matchAll(NUMBER)].map(match => ({
    token: match[0],
    percent: source.slice(match.index + match[0].length).trimStart()[0] === '%',
  }));
}
// Only small whole counts ("2 habits") are exempt. A percentage must also be a percentage
// in the facts, so "+99 gold" cannot come back as "99%".
function groundedText(text, allowed) {
  return numbersIn(text).every(({token, percent}) => {
    if (/^\d+$/.test(token) && Number(token) <= SMALL_NUMBER && !percent) return true;
    const pool = percent ? allowed.percent : allowed.any;
    return variants(token).some(variant => pool.has(variant));
  });
}

export function groundAnswer(answer, facts) {
  const found = numbersIn(JSON.stringify(facts));
  const allowed = {
    any: new Set(found.flatMap(({token}) => variants(token))),
    percent: new Set(found.filter(({percent}) => percent).flatMap(({token}) => variants(token))),
  };
  const sentences = String(answer.summary ?? '')
    .split(/(?<=[.!?])\s+/)
    .filter(Boolean);
  const keptSentences = sentences.filter(sentence => groundedText(sentence, allowed));
  const focus = (answer.focus ?? []).filter(item =>
    [item.title, item.why, item.drill].every(field => groundedText(field, allowed)),
  );
  return {
    summary: keptSentences.join(' '),
    focus,
    removed: sentences.length - keptSentences.length + (answer.focus ?? []).length - focus.length,
  };
}

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    summary: {type: 'string'},
    focus: {
      type: 'array',
      maxItems: MAX_FOCUS,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {title: {type: 'string'}, why: {type: 'string'}, drill: {type: 'string'}},
        required: ['title', 'why', 'drill'],
      },
    },
  },
  required: ['summary', 'focus'],
};

export const MAX_STYLE_CHARS = 4000;

// The user's own style file (tone, game terms, example paragraphs). Missing means none.
export async function readStyle(path, readFile) {
  if (!path) return '';
  try {
    return String(await readFile(path, 'utf8'))
      .trim()
      .slice(0, MAX_STYLE_CHARS);
  } catch {
    return '';
  }
}

// Fixed rules first; a personal style can change tone and wording but not these rules,
// and the number check in groundAnswer applies whatever the style says.
export function systemPrompt(language, style = '') {
  const rules = baseRules(language);
  if (!style) return rules;
  return language === 'en'
    ? `${rules}

Personal writing style from the user (tone, wording, game terms, examples). It must not break the rules above:
${style}`
    : `${rules}

Phong cách viết riêng của người dùng (giọng, cách xưng hô, thuật ngữ, ví dụ). Phần này không được làm trái các quy tắc trên:
${style}`;
}

function baseRules(language) {
  return language === 'en'
    ? 'You are a League of Legends coach. Use only the numbers in FACTS; never calculate or add new numbers. ' +
        'Differences are correlations, not proven causes. Write natural, concise English. ' +
        'summary: 2-4 sentences connecting the most important facts. focus: up to 3 items; ' +
        'title is a short focus name, why cites the evidence from FACTS, drill is one concrete thing to practise in the next games.'
    : 'Bạn là huấn luyện viên League of Legends. Chỉ dùng số liệu có trong FACTS, không tự tính hay thêm số mới. ' +
        'Khác biệt chỉ là tương quan, không khẳng định nguyên nhân. Viết tiếng Việt tự nhiên, ngắn gọn. ' +
        'summary: 2-4 câu nối các điểm quan trọng nhất. focus: tối đa 3 mục; title là tên trọng tâm ngắn, ' +
        'why trích dẫn bằng chứng từ FACTS, drill là một việc cụ thể để tập trong các trận tới.';
}

function parseAnswer(content) {
  const text = String(content ?? '')
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, '');
  let answer;
  try {
    answer = JSON.parse(text);
  } catch {
    throw aiError('AI_BAD_OUTPUT', 'AI trả về nội dung không đọc được. Thử lại.', 502);
  }
  const short = value => typeof value === 'string' && value.length <= 1500;
  if (
    !answer ||
    !short(answer.summary) ||
    !Array.isArray(answer.focus) ||
    !answer.focus.every(item => item && short(item.title) && short(item.why) && short(item.drill))
  )
    throw aiError('AI_BAD_OUTPUT', 'AI trả về nội dung không đúng cấu trúc. Thử lại.', 502);
  return {summary: answer.summary.trim(), focus: answer.focus.slice(0, MAX_FOCUS)};
}

export async function requestSummary(facts, {config, fetchImpl = fetch, style = ''}) {
  validateFacts(facts);
  let response;
  try {
    response = await fetchImpl(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.apiKey ? {Authorization: `Bearer ${config.apiKey}`} : {}),
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0.2,
        ...(config.reasoningEffort ? {reasoning_effort: config.reasoningEffort} : {}),
        response_format: {
          type: 'json_schema',
          json_schema: {name: 'coaching_summary', strict: true, schema: SCHEMA},
        },
        messages: [
          {role: 'system', content: systemPrompt(facts.language, style)},
          {role: 'user', content: 'FACTS:\n' + JSON.stringify(facts)},
        ],
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    if (error?.name === 'TimeoutError') throw aiError('AI_TIMEOUT', 'AI phản hồi quá lâu. Thử lại sau.', 504);
    throw aiError('AI_UNAVAILABLE', 'Không kết nối được dịch vụ AI. Kiểm tra Ollama đang chạy.', 503);
  }
  if (!response.ok)
    throw aiError('AI_UPSTREAM', `Dịch vụ AI trả lỗi (HTTP ${response.status}). Kiểm tra AI_MODEL.`, 502);
  let body;
  try {
    body = await response.json();
  } catch {
    throw aiError('AI_BAD_OUTPUT', 'AI trả về nội dung không đọc được. Thử lại.', 502);
  }
  const answer = parseAnswer(body?.choices?.[0]?.message?.content);
  return {...groundAnswer(answer, facts), model: typeof body.model === 'string' ? body.model : config.model};
}
