export const LAB_MAX_BYTES=8*1024*1024;
export class DataLabInputError extends Error {
 constructor(message='Invalid Data Lab input.'){super(message);this.name='DataLabInputError';this.code='INVALID_LAB_DATA';}
}
const fail=message=>{throw new DataLabInputError(message);};
const sensitiveKeys=new Set(['apikey','riotapikey','xriottoken','authorization','proxyauthorization','headers','requestheaders','responseheaders','credentials','password','accesstoken','refreshtoken','clientsecret','cookie','setcookie','xapikey','privatekey','secretkey','passwd']);
export function assertLabSize(value) {
 let serialized;
 try {serialized=typeof value==='string'?value:JSON.stringify(value);}
 catch {fail('Data Lab input must be serializable JSON.');}
 if(typeof serialized!=='string'||new TextEncoder().encode(serialized).byteLength>LAB_MAX_BYTES)fail('Data Lab JSON exceeds 8 MiB.');
}
// Keep the entire JSON body intact. Unsafe inputs fail instead of being silently
// scrubbed and mislabeled as an original response. Request metadata is not a body.
export function cloneLabRawBody(value) {
 const visited=new Set();
 const inspect=(node,depth)=>{
  if(depth>64)fail('Raw match JSON is nested too deeply.');
  if(node===null||typeof node==='boolean')return;
  if(typeof node==='string'){if(/RGAPI-|(?:^|\s)(?:Bearer|Basic)\s+[A-Za-z0-9+/_=.~-]{8,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i.test(node))fail('Credentials are not allowed in raw match JSON.');return;}
  if(typeof node==='number'){if(!Number.isFinite(node))fail('Raw match JSON contains an invalid number.');return;}
  if(typeof node!=='object'||visited.has(node))fail('Raw match body must be valid JSON.');
  if(!Array.isArray(node)&&![Object.prototype,null].includes(Object.getPrototypeOf(node)))fail('Raw match body must contain plain JSON objects.');
  visited.add(node);
  for(const [key,child] of Object.entries(node)){
   if(sensitiveKeys.has(key.toLowerCase().replace(/[^a-z0-9]/g,'')))fail('Credentials and headers are not allowed in raw match JSON.');
   inspect(child,depth+1);
  }
  visited.delete(node);
 };
 inspect(value,0);assertLabSize(value);
 return JSON.parse(JSON.stringify(value));
}
