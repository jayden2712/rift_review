import {RiotError, createRiotClient, createMemoryRiotCache, loadRiotHistory, loadLobbyRank} from './riot.js';

const localRiotCache=createMemoryRiotCache();

export function jsonResponse(value,status=200,extra={}) {
  return new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff',...extra}});
}
export async function handleApi(request,env,{cache=null,fetchImpl=fetch}={}) {
  if(!request.headers.get('oai-authenticated-user-id'))return jsonResponse({error:{code:'SIGN_IN_REQUIRED',message:'Đăng nhập tài khoản có quyền truy cập web để tra cứu.'}},401);
  const url=new URL(request.url);
  if(url.pathname==='/api/status'&&request.method==='GET')return jsonResponse({riotConfigured:Boolean(env.RIOT_API_KEY)});
  if(!['/api/history','/api/lobby-rank'].includes(url.pathname))return jsonResponse({error:{code:'NOT_FOUND',message:'Không tìm thấy chức năng này.'}},404);
  if(request.method!=='POST')return jsonResponse({error:{code:'METHOD_NOT_ALLOWED',message:'Dùng chức năng Tra cứu trên web.'}},405,{Allow:'POST'});
  // Only a same-origin browser page or authenticated API client can initiate a lookup.
  if(request.headers.get('Origin')&&request.headers.get('Origin')!==url.origin)return jsonResponse({error:{code:'ORIGIN_REJECTED',message:'Yêu cầu không đến từ web này.'}},403);
  if(request.headers.get('Sec-Fetch-Site')==='cross-site')return jsonResponse({error:{code:'ORIGIN_REJECTED',message:'Yêu cầu không đến từ web này.'}},403);
  if(!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json'))return jsonResponse({error:{code:'INVALID_CONTENT',message:'Dữ liệu tra cứu cần là JSON.'}},415);
  if(Number(request.headers.get('Content-Length'))>2048)return jsonResponse({error:{code:'INPUT_TOO_LARGE',message:'Riot ID quá dài.'}},413);
  try {
    const text=await request.text();if(text.length>2048)throw new RiotError('INPUT_TOO_LARGE','Riot ID quá dài.',413);
    let input;try{input=JSON.parse(text);}catch{throw new RiotError('INVALID_JSON','Dữ liệu tra cứu không hợp lệ.',400);}
    const client=createRiotClient({key:env.RIOT_API_KEY,origin:url.origin,cache:cache||localRiotCache,fetchImpl});
    return jsonResponse(await (url.pathname==='/api/lobby-rank'?loadLobbyRank:loadRiotHistory)(input,client));
  } catch(error) {
    if(error instanceof RiotError)return jsonResponse({error:{code:error.code,message:error.message,retryAfter:error.retryAfter||undefined}},error.status,error.retryAfter?{'Retry-After':String(error.retryAfter)}:{});
    // Never log request headers, raw upstream errors, or provider credentials.
    return jsonResponse({error:{code:'SERVER_ERROR',message:'Chưa thể lấy lịch sử. Dữ liệu đang xem được giữ nguyên; thử lại sau.'}},500);
  }
}
export default {
  async fetch(request,env,ctx) {
    const url=new URL(request.url);
    if(url.pathname.startsWith('/api/'))return handleApi(request,env,{cache:typeof caches!=='undefined'?caches.default:null});
    if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405,headers:{Allow:'GET, HEAD'}});
    const path=url.pathname==='/'?'/index.html':url.pathname;
    // STATIC_ASSETS is generated from the existing public folder at build time.
    const asset=Object.hasOwn(STATIC_ASSETS,path)?STATIC_ASSETS[path]:null;
    if(!asset)return new Response('Not found',{status:404});
    const body=request.method==='HEAD'?null:asset.encoding==='base64'
      ?Uint8Array.from(atob(asset.body), character=>character.charCodeAt(0)):asset.body;
    return new Response(body,{headers:{'Content-Type':asset.type,'Cache-Control':'private, no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin'}});
  }
};
