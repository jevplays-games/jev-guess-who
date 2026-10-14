import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { ROSTER } from '../public/shared/roster.js';
const hair = {black:'#1E1E1E',brown:'#7A4A2E',blond:'#E8A33D',red:'#C0392B'};
const skins = ['#C98E67','#E5B996','#AC7657','#F0CEB0','#926047','#DBA57E'];
const allowed = new Set(['#F386A1','#1E1E1E','#E551BA','#DEDEDE','#FEFEFE','#9A9A9A','#155A80','#4A4A4A','#7A4A2E','#9C6440','#E8A33D','#F4C873','#C0392B','#D9583F',...skins]);
const root='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" role="img" shape-rendering="crispEdges">';
let raw=0,gzip=0,over=0;
for(const c of ROSTER){
 const svg=readFileSync(new URL(`../public/portraits/${c.id}.svg`,import.meta.url),'utf8');
 assert(svg.startsWith(root),`${c.id}: root`);
 assert.equal(svg.match(/<title>(.*?)<\/title>/)?.[1],c.name,`${c.id}: title`);
 assert(!/<(?:\w*gradient|filter|text|image|script|mask)\b/i.test(svg),`${c.id}: forbidden element`);
 const paths=[...svg.matchAll(/<path fill="(#[A-F0-9]{6})" d="([^"]+)"\/>/g)];
 assert.equal(svg,root+`<title>${c.name}</title>`+paths.map(m=>m[0]).join('')+'</svg>',`${c.id}: strict format`);
 const colors=paths.map(m=>m[1]);
 assert.equal(new Set(colors).size,colors.length,`${c.id}: one path per color`);
 for(const [ ,color,d] of paths){
  assert(allowed.has(color),`${c.id}: invalid fill ${color}`);
  const runs=[...d.matchAll(/M(\d+) (\d+)h(\d+)v4h-(\d+)z/g)];
  assert.equal(runs.map(m=>m[0]).join(''),d,`${c.id}: horizontal runs`);
  for(const m of runs){const [x,y,w,back]=m.slice(1).map(Number);assert(x%4===0&&y%4===0&&w%4===0&&w===back&&x+w<=120&&y<120,`${c.id}: grid`);}
 }
 assert(colors.includes(hair[c.hairColor]),`${c.id}: missing hair color`);
 assert.equal(colors.includes('#E551BA'),c.earrings,`${c.id}: earrings`);
 assert.equal(colors.includes('#155A80'),c.scarf,`${c.id}: scarf`);
 for(const [type,color] of Object.entries(hair))if(type!=='black'&&type!==c.hairColor)assert(!colors.includes(color),`${c.id}: wrong hair color`);
 const size=Buffer.byteLength(svg);raw+=size;gzip+=gzipSync(svg).length;if(size>2000)over++;
}
console.log(`24 portraits: ${raw} raw bytes; ${gzip} gzip bytes (sum of individually compressed SVGs).`);
console.log(`${over} portraits exceed the advisory 2,000-byte raw target.`);
assert(gzip<=17900,`Portrait gzip budget exceeded: ${gzip} > 17900`);
