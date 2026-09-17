import {mkdir, readdir, readFile, writeFile, rm} from 'node:fs/promises';
const manifest=JSON.parse(await readFile('.openai/hosting.json','utf8'));
const mime={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'};
const assets={};
for(const file of await readdir('public')) {
  const suffix=file.slice(file.lastIndexOf('.'));
  if(!mime[suffix])throw new Error('Unsupported public asset type: '+file);
  assets['/'+file]={type:mime[suffix],body:await readFile('public/'+file,'utf8')};
}
const api=await readFile('server/riot.js','utf8');
const worker=(await readFile('server/worker.js','utf8')).replace("import {RiotError, createRiotClient, loadRiotHistory} from './riot.js';",'');
await rm('dist',{recursive:true,force:true});
await mkdir('dist/server',{recursive:true});
await mkdir('dist/.openai',{recursive:true});
await writeFile('dist/server/index.js','const STATIC_ASSETS='+JSON.stringify(assets)+';\n'+api+'\n'+worker);
await writeFile('dist/.openai/hosting.json',JSON.stringify(manifest,null,2));
console.log('Built Worker with private Riot API and embedded public assets.');
