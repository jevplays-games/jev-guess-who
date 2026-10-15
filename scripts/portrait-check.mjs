import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { ROSTER } from '../public/shared/roster.js';
// Hair colour is a question, so the four hair colours form a lightness ladder (black < brown < red < blond)
// that survives colour-vision deficiency; red was #C0392B and brown #7A4A2E, which protanopia collapsed into
// one olive (CIEDE2000 4.2). Highlights: brown #8D5544, red #D96526, blond #F4C873, black #4A4A4A.
const hair = {black:'#1E1E1E',brown:'#6A4639',blond:'#E8A33D',red:'#D24E2D'};
const skins = ['#C98E67','#E5B996','#AC7657','#F0CEB0','#926047','#DBA57E'];
const allowed = new Set(['#F386A1','#1E1E1E','#E551BA','#DEDEDE','#FEFEFE','#9A9A9A','#155A80','#4A4A4A','#6A4639','#8D5544','#E8A33D','#F4C873','#D24E2D','#D96526',...skins]);
// Every pair of hair colours must stay at least CIEDE2000 15 apart for normal vision and under simulated
// protanopia, deuteranopia, tritanopia (Machado et al. 2009, severity 1) and achromatopsia (luminance only).
const toLinear=c=>c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4,toSrgb=c=>{c=Math.min(1,Math.max(0,c));return c<=0.0031308?c*12.92:1.055*c**(1/2.4)-0.055;};
const CVD={protan:[[0.152286,1.052583,-0.204868],[0.114503,0.786281,0.099216],[-0.003882,-0.048116,1.051998]],deutan:[[0.367322,0.860646,-0.227968],[0.280085,0.672501,0.047413],[-0.011820,0.042940,0.968881]],tritan:[[1.255528,-0.076749,-0.178779],[-0.078411,0.930809,0.147602],[0.004733,0.691367,0.303900]]};
function simulate(hex,kind){
  const lin=[1,3,5].map(i=>toLinear(parseInt(hex.slice(i,i+2),16)/255));
  if(kind==='normal')return lin.map(toSrgb);
  if(kind==='achroma'){const y=0.2126*lin[0]+0.7152*lin[1]+0.0722*lin[2];return [y,y,y].map(toSrgb);}
  return CVD[kind].map(row=>toSrgb(row[0]*lin[0]+row[1]*lin[1]+row[2]*lin[2]));
}
function lab(rgb){
  const [r,g,b]=rgb.map(toLinear),f=t=>t>0.008856?Math.cbrt(t):7.787*t+16/116;
  const x=f((0.4124*r+0.3576*g+0.1805*b)/0.95047),y=f(0.2126*r+0.7152*g+0.0722*b),z=f((0.0193*r+0.1192*g+0.9505*b)/1.08883);
  return [116*y-16,500*(x-y),200*(y-z)];
}
function deltaE2000(p,q){
  const rad=Math.PI/180,[L1,a1,b1]=lab(p),[L2,a2,b2]=lab(q),Cb=(Math.hypot(a1,b1)+Math.hypot(a2,b2))/2;
  const G=0.5*(1-Math.sqrt(Cb**7/(Cb**7+25**7))),A1=(1+G)*a1,A2=(1+G)*a2,C1=Math.hypot(A1,b1),C2=Math.hypot(A2,b2);
  const h1=(Math.atan2(b1,A1)/rad+360)%360,h2=(Math.atan2(b2,A2)/rad+360)%360;
  const dh=C1*C2===0?0:Math.abs(h2-h1)<=180?h2-h1:h2-h1>180?h2-h1-360:h2-h1+360;
  const dL=L2-L1,dC=C2-C1,dH=2*Math.sqrt(C1*C2)*Math.sin(dh/2*rad),Lb=(L1+L2)/2,Cp=(C1+C2)/2;
  const hb=C1*C2===0?h1+h2:Math.abs(h1-h2)<=180?(h1+h2)/2:h1+h2<360?(h1+h2+360)/2:(h1+h2-360)/2;
  const T=1-0.17*Math.cos((hb-30)*rad)+0.24*Math.cos(2*hb*rad)+0.32*Math.cos((3*hb+6)*rad)-0.20*Math.cos((4*hb-63)*rad);
  const SL=1+0.015*(Lb-50)**2/Math.sqrt(20+(Lb-50)**2),SC=1+0.045*Cp,SH=1+0.015*Cp*T;
  const RT=-Math.sin(2*30*Math.exp(-(((hb-275)/25)**2))*rad)*2*Math.sqrt(Cp**7/(Cp**7+25**7));
  return Math.sqrt((dL/SL)**2+(dC/SC)**2+(dH/SH)**2+RT*(dC/SC)*(dH/SH));
}
let closestHair={value:Infinity};
for(const [i,[nameA,a]] of Object.entries(hair).entries())for(const [nameB,b] of Object.entries(hair).slice(i+1))
  for(const kind of ['normal','protan','deutan','tritan','achroma']){
    const value=deltaE2000(simulate(a,kind),simulate(b,kind));
    if(value<closestHair.value)closestHair={value,pair:`${nameA}/${nameB}`,kind};
  }
console.log(`Closest hair colours under any simulated vision: ${closestHair.pair} (${closestHair.kind}): CIEDE2000 ${closestHair.value.toFixed(1)}.`);
assert(closestHair.value>=15,`Hair colours ${closestHair.pair} are too close under ${closestHair.kind} vision: ${closestHair.value.toFixed(1)} < 15`);
const root='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" role="img" shape-rendering="crispEdges">';
let raw=0,gzip=0,over=0;
const grids=[];
for(const c of ROSTER){
 const svg=readFileSync(new URL(`../public/portraits/${c.id}.svg`,import.meta.url),'utf8');
 assert(svg.startsWith(root),`${c.id}: root`);
 assert.equal(svg.match(/<title>(.*?)<\/title>/)?.[1],c.name,`${c.id}: title`);
 assert(!/<(?:\w*gradient|filter|text|image|script|mask)\b/i.test(svg),`${c.id}: forbidden element`);
 const paths=[...svg.matchAll(/<path fill="(#[A-F0-9]{6})" d="([^"]+)"\/>/g)];
 assert.equal(svg,root+`<title>${c.name}</title>`+paths.map(m=>m[0]).join('')+'</svg>',`${c.id}: strict format`);
 const colors=paths.map(m=>m[1]);
 const grid=Array(900).fill(null);
 for(const [,color,d] of paths){
  for(const run of d.matchAll(/M(\d+) (\d+)h(\d+)v4h-(\d+)z/g)){
   const [x,y,w]=run.slice(1).map(Number);
   for(let col=x/4;col<(x+w)/4;col++)grid[y/4*30+col]=color;
  }
 }
 grids.push({id:c.id,name:c.name,grid});
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
let minimum={count:Infinity};
for(let i=0;i<grids.length;i++)for(let j=i+1;j<grids.length;j++){
 const a=grids[i],b=grids[j];
 const count=a.grid.reduce((sum,color,k)=>sum+Number(color!==b.grid[k]),0);
 if(count<minimum.count)minimum={a,b,count};
}
console.log(`Minimum pairwise difference: ${minimum.a.id} ${minimum.a.name} / ${minimum.b.id} ${minimum.b.name}: ${minimum.count} cells.`);
assert(minimum.count>=60,`Portrait pair differs in fewer than 60 cells: ${minimum.count}`);
assert(gzip<=17900,`Portrait gzip budget exceeded: ${gzip} > 17900`);
