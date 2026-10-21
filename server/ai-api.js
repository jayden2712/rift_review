// Local-only AI routes, mounted by server/local.js when AI_ENABLED=1. The hosted Worker
// never includes this module.
import {jsonResponse} from './worker.js';
import {RiotError} from './riot.js';
import {readFile} from 'node:fs/promises';
import {isAbsolute, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {aiConfig, readStyle, requestSummary} from './ai.js';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const DEFAULT_STYLE_FILE = '.local/ai-style.md';

export const AI_BODY_LIMIT = 32768;

function errorResponse(error) {
  if (error instanceof RiotError)
    return jsonResponse({error: {code: error.code, message: error.message}}, error.status);
  // Never echo raw errors: they can contain the API key or upstream URLs.
  return jsonResponse({error: {code: 'SERVER_ERROR', message: 'Chưa thể tạo tóm tắt AI. Thử lại sau.'}}, 500);
}

export function createAiApi({env = {}, fetchImpl = fetch, readFileImpl = readFile} = {}) {
  const styleSetting =
    typeof env.AI_STYLE_FILE === 'string' && env.AI_STYLE_FILE.trim()
      ? env.AI_STYLE_FILE.trim()
      : DEFAULT_STYLE_FILE;
  const stylePath = isAbsolute(styleSetting) ? styleSetting : resolve(projectRoot, styleSetting);
  return async function aiApi(request) {
    const {pathname} = new URL(request.url);
    try {
      const config = aiConfig(env);
      if (pathname === '/api/ai/status') {
        if (request.method !== 'GET')
          return jsonResponse({error: {code: 'METHOD_NOT_ALLOWED', message: 'Dùng GET.'}}, 405, {
            Allow: 'GET',
          });
        return jsonResponse({enabled: true, model: config.model});
      }
      if (pathname !== '/api/ai/summary')
        return jsonResponse({error: {code: 'NOT_FOUND', message: 'Không tìm thấy chức năng này.'}}, 404);
      if (request.method !== 'POST')
        return jsonResponse({error: {code: 'METHOD_NOT_ALLOWED', message: 'Dùng POST.'}}, 405, {
          Allow: 'POST',
        });
      if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json'))
        return jsonResponse({error: {code: 'INVALID_CONTENT', message: 'Yêu cầu cần là JSON.'}}, 415);
      let input;
      try {
        input = JSON.parse(await request.text());
      } catch {
        throw new RiotError('INVALID_JSON', 'Dữ liệu gửi cho AI không hợp lệ.', 400);
      }
      // Read on every request so edits to the style file apply on the next "Rewrite".
      const style = await readStyle(stylePath, readFileImpl);
      return jsonResponse(await requestSummary(input?.facts, {config, fetchImpl, style}));
    } catch (error) {
      return errorResponse(error);
    }
  };
}
