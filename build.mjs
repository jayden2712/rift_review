import {mkdir, readdir, readFile, writeFile, rm} from 'node:fs/promises';
const manifest=JSON.parse(await readFile('.openai/hosting.json','utf8'));
const mime={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'};
async function readAsset(file, binary = false) {
  const body = await readFile('public/' + file);
  return ['/' + file, binary
    ? {type: 'image/png', encoding: 'base64', body: body.toString('base64')}
    : {type: mime[file.slice(file.lastIndexOf('.'))], body: body.toString('utf8')}];
}

const entries = await Promise.all((await readdir('public', {withFileTypes: true})).map(async entry => {
  if (['champions', 'items', 'spells', 'runes', 'ranks'].includes(entry.name) && entry.isDirectory()) {
    return Promise.all((await readdir('public/' + entry.name, {withFileTypes: true})).map(image => {
      if (!image.isFile() || !/^[a-zA-Z0-9]+\.png$/.test(image.name)) {
        throw new Error('Unsupported public asset: ' + entry.name + '/' + image.name);
      }
      return readAsset(entry.name + '/' + image.name, true);
    }));
  }
  if (!entry.isFile() || !/^[a-zA-Z0-9_-]+\.(html|js|css|svg)$/.test(entry.name)) {
    throw new Error('Unsupported public asset: ' + entry.name);
  }
  return [await readAsset(entry.name)];
}));
const assets = Object.fromEntries(entries.flat());
const api=await readFile('server/riot.js','utf8');
const worker=(await readFile('server/worker.js','utf8')).replace(/^import \{[^}]+\} from '\.\/riot\.js';\r?\n/m, '');
await rm('dist',{recursive:true,force:true});
await mkdir('dist/server',{recursive:true});
await mkdir('dist/.openai',{recursive:true});
await writeFile('dist/server/index.js','const STATIC_ASSETS='+JSON.stringify(assets)+';\n'+api+'\n'+worker);
await writeFile('dist/.openai/hosting.json',JSON.stringify(manifest,null,2));
console.log('Built Worker with private Riot API and embedded public assets.');
