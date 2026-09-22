import {readdir,readFile,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {gzipSync} from 'node:zlib';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateRoster} from '../public/shared/roster.js';
const root=fileURLToPath(new URL('../',import.meta.url));
async function walk(dir){let files=[];for(const e of await readdir(dir,{withFileTypes:true})){if(['data','node_modules','.git','.wrangler','__pycache__'].includes(e.name))continue;const f=path.join(dir,e.name);if(e.isDirectory())files.push(...await walk(f));else files.push(f);}return files;}
const files=await walk(root),modules=files.filter(f=>/\.(mjs|js)$/.test(f));
for(const f of modules){const r=spawnSync(process.execPath,['--check',f],{encoding:'utf8'});if(r.status!==0)throw Error(`${path.relative(root,f)}\n${r.stderr}`);}
validateRoster();
const publicFiles=files.filter(f=>f.startsWith(path.join(root,'public')+path.sep));
let total=0,js=0;const assets=[];
for(const f of publicFiles){const b=await readFile(f),gzipBytes=gzipSync(b).length;assets.push({path:path.relative(root,f),bytes:b.length,gzipBytes});total+=gzipBytes;if(f.endsWith('.js'))js+=gzipBytes;}
const checks={syntaxModules:modules.length,rosterValid:true,publicGzipBytes:total,publicJavaScriptGzipBytes:js,budgets:{javaScript:60000,allPublicAssets:150000},assets,limitations:['Gzip sums are theoretical file-by-file sizes, not measured CDN transfer sizes.','This is a syntax, roster and asset-budget check; not a security audit or comprehensive linter.']};
await writeFile(path.join(root,'reports','static-checks.json'),JSON.stringify(checks,null,2)+'\n');
if(js>60000||total>150000)throw Error('Asset budget exceeded; see reports/static-checks.json');
console.log(JSON.stringify({...checks,assets:undefined},null,2));
