// Local-only routes for importing ARAM Mayhem from the League client. Mounted by
// server/local.js when LCU_ENABLED=1; the hosted Worker never includes this module.
import {jsonResponse} from './worker.js';
import {RiotError} from './riot.js';
import {connectLcu, lcuStatus, loadLcuMayhem} from './lcu.js';

const STATUS_BY_CODE = Object.freeze({
  LCU_CLIENT_CLOSED: 'client_closed',
  LCU_NOT_SIGNED_IN: 'not_signed_in',
});
const notFound = () =>
  jsonResponse({error: {code: 'NOT_FOUND', message: 'Không tìm thấy chức năng này.'}}, 404);

function errorResponse(error) {
  if (error instanceof RiotError)
    return jsonResponse({error: {code: error.code, message: error.message}}, error.status);
  // Never echo raw errors: they can contain install paths or lockfile contents.
  return jsonResponse(
    {error: {code: 'SERVER_ERROR', message: 'Chưa thể đọc dữ liệu từ client LoL. Thử lại sau.'}},
    500,
  );
}

async function status(connect) {
  try {
    return jsonResponse({enabled: true, ...(await lcuStatus(connect()))});
  } catch (error) {
    const known = error instanceof RiotError && STATUS_BY_CODE[error.code];
    if (known) return jsonResponse({enabled: true, status: known});
    return errorResponse(error);
  }
}

export function createLcuApi({env = {}, connect = () => connectLcu({env})} = {}) {
  return async function lcuApi(request) {
    const {pathname} = new URL(request.url);
    const method = request.method;
    if (pathname === '/api/lcu/status') {
      if (method !== 'GET')
        return jsonResponse({error: {code: 'METHOD_NOT_ALLOWED', message: 'Dùng GET.'}}, 405, {Allow: 'GET'});
      return status(connect);
    }
    if (pathname !== '/api/lcu/import') return notFound();
    if (method !== 'POST')
      return jsonResponse({error: {code: 'METHOD_NOT_ALLOWED', message: 'Dùng POST.'}}, 405, {Allow: 'POST'});
    // Requiring JSON keeps plain cross-site form posts from triggering an import.
    if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json'))
      return jsonResponse({error: {code: 'INVALID_CONTENT', message: 'Yêu cầu cần là JSON.'}}, 415);
    try {
      return jsonResponse(await loadLcuMayhem(connect()));
    } catch (error) {
      return errorResponse(error);
    }
  };
}
