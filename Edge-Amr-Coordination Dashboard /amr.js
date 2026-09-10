'use strict';
/* ================= UTIL ================= */
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const lerp=(a,b,t)=>a+(b-a)*t;
const rnd=(a,b)=>a+Math.random()*(b-a);
const pick=a=>a[Math.floor(Math.random()*a.length)];
const fmtT=s=>{s=Math.floor(s);return String(Math.floor(s/3600)%24).padStart(2,'0')+':'+String(Math.floor(s/60)%60).padStart(2,'0')+':'+String(s%60).padStart(2,'0')};

/* ================= GRID / MAP ================= */
const COLS=42, ROWS=28;
const W=(c,r)=>({x:c-COLS/2+.5, z:r-ROWS/2+.5});
const cellOf=(x,z)=>({c:Math.round(x+COLS/2-.5), r:Math.round(z+ROWS/2-.5)});
const CI=(c,r)=>r*COLS+c;
const sector=(c,r)=>'ABCDEF'[clamp(Math.floor(c/7),0,5)]+(clamp(Math.floor(r/7),0,3)+1);
const STAT=new Uint8Array(COLS*ROWS), DYN=new Set();
const RACK_ROWS=[[5,6],[10,11],[15,16],[20,21]], SEGS=[[6,16],[18,25],[28,35]];
RACK_ROWS.forEach(([r0,r1])=>SEGS.forEach(([c0,c1])=>{for(let r=r0;r<=r1;r++)for(let c=c0;c<=c1;c++)STAT[CI(c,r)]=1;}));
const PADS=[[4,24],[7,24],[10,24],[13,24]].map(([c,r],i)=>({c,r,i,occ:null,mesh:null,pulse:null}));
const STNS=[[28,2],[32,2],[36,2]].map(([c,r],i)=>({c,r,i,ap:{c,r:3}}));
const GATE={c:39,r:25};
const PICKS=[];
for(let r=3;r<=23;r++)for(let c=4;c<=37;c++){
  if(STAT[CI(c,r)])continue;
  if((r>0&&!STAT[CI(c,r-1)])||(r<ROWS-1&&!STAT[CI(c,r+1)])||(c>0&&!STAT[CI(c-1,r)])||(c<COLS-1&&!STAT[CI(c+1,r)]))continue;
  PICKS.push({c,r});
}
const freeCell=(c,r,extra)=>c>=0&&r>=0&&c<COLS&&r<ROWS&&!STAT[CI(c,r)]&&!DYN.has(CI(c,r))&&!(extra&&extra.has(CI(c,r)));

/* ================= A* ================= */
function astar(c0,r0,c1,r1,extra){
  if(!freeCell(c1,r1,extra))return null;
  const N=COLS*ROWS,g=new Float64Array(N).fill(1e9),came=new Int32Array(N).fill(-1),done=new Uint8Array(N);
  const H=(c,r)=>Math.abs(c-c1)+Math.abs(r-r1);
  const open=[{i:CI(c0,r0),f:H(c0,r0)}]; g[open[0].i]=0; let guard=0;
  while(open.length&&guard++<5000){
    let bi=0;for(let i=1;i<open.length;i++)if(open[i].f<open[bi].f)bi=i;
    const cur=open.splice(bi,1)[0].i;
    if(done[cur])continue; done[cur]=1;
    if(cur===CI(c1,r1)){const path=[];let n=cur;while(n!==-1){path.push({c:n%COLS,r:Math.floor(n/COLS)});n=came[n];}return path.reverse();}
    const cc=cur%COLS, cr=Math.floor(cur/COLS);
    for(const[dc,dr]of[[1,0],[-1,0],[0,1],[0,-1]]){
      const nc=cc+dc,nr=cr+dr;
      if(!freeCell(nc,nr,extra))continue;
      const ni=CI(nc,nr),ng=g[cur]+1;
      if(ng<g[ni]){g[ni]=ng;came[ni]=cur;open.push({i:ni,f:ng+H(nc,nr)});}
    }
  }
  return null;
}
function simplify(path){
  if(path.length<3)return path;
  const out=[path[0]];
  for(let i=1;i<path.length-1;i++){
    const a=path[i-1],b=path[i],c=path[i+1];
    if((a.c===b.c&&b.c===c.c)||(a.r===b.r&&b.r===c.r))continue;
    out.push(b);
  }
  out.push(path[path.length-1]); return out;
}

/* ================= THREE SETUP ================= */
const vp=document.getElementById('vp');
const renderer=new THREE.WebGLRenderer({antialias:true});
renderer.setPixelRatio(Math.min(devicePixelRatio,2));
renderer.shadowMap.enabled=true; renderer.shadowMap.type=THREE.PCFSoftShadowMap;
renderer.outputEncoding=THREE.sRGBEncoding;
renderer.toneMapping=THREE.ACESFilmicToneMapping; renderer.toneMappingExposure=1.08;
vp.appendChild(renderer.domElement);
const scene=new THREE.Scene();
scene.background=new THREE.Color(0x070b10);
scene.fog=new THREE.FogExp2(0x070b10,0.013);
const camera=new THREE.PerspectiveCamera(50,1,0.1,220);

scene.add(new THREE.HemisphereLight(0x8fb3cc,0x0b0f13,0.5));
const sun=new THREE.DirectionalLight(0xffe2b8,0.9);
sun.position.set(16,28,12); sun.castShadow=true;
sun.shadow.mapSize.set(2048,2048);
Object.assign(sun.shadow.camera,{left:-30,right:30,top:30,bottom:-30,near:4,far:80});
scene.add(sun);
const rimB=new THREE.PointLight(0x2f79b8,0.5,70); rimB.position.set(-26,9,-16); scene.add(rimB);
const rimW=new THREE.PointLight(0xb8662f,0.4,60); rimW.position.set(25,6,18); scene.add(rimW);

/* ---- floor + grid + markings ---- */
const floor=new THREE.Mesh(new THREE.PlaneGeometry(COLS+6,ROWS+6),
  new THREE.MeshStandardMaterial({color:0x0e141b,roughness:.95,metalness:0}));
floor.rotation.x=-Math.PI/2; floor.receiveShadow=true; scene.add(floor);
{
  const mk=(step,col,op)=>{const p=[];
    for(let c=-COLS/2;c<=COLS/2;c+=step)p.push(c,0,-ROWS/2,c,0,ROWS/2);
    for(let r=-ROWS/2;r<=ROWS/2;r+=step)p.push(-COLS/2,0,r,COLS/2,0,r);
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));
    const l=new THREE.LineSegments(g,new THREE.LineBasicMaterial({color:col,transparent:true,opacity:op}));
    l.position.y=.01; scene.add(l);};
  mk(1,0x16222c,.5); mk(4,0x20333f,.7);
}
function strip(x,z,len,horizontal,y){
  const m=new THREE.Mesh(new THREE.PlaneGeometry(horizontal?len:.14,horizontal?.14:len),
    new THREE.MeshBasicMaterial({color:0xc79a3a,transparent:true,opacity:.26}));
  m.rotation.x=-Math.PI/2; m.position.set(x,y,z); scene.add(m);
}
strip(W(17,0).x,0,ROWS,true===false?0:0,0); // placeholder removed below
scene.children.pop();
strip(W(17,0).x,0,ROWS-1,false,.012);
[8,13,18].forEach((r,i)=>strip(2,W(r,0).z,34,true,.012+i*.002));

/* ---- walls ---- */
{
  const mat=new THREE.MeshStandardMaterial({color:0x121c26,roughness:.9});
  const mk=(w,d,x,z)=>{const m=new THREE.Mesh(new THREE.BoxGeometry(w,1.5,d),mat);m.position.set(x,.75,z);m.castShadow=true;scene.add(m);
    const e=new THREE.Mesh(new THREE.BoxGeometry(w+.02,.05,d+.02),new THREE.MeshBasicMaterial({color:0x1f3547}));e.position.set(x,1.52,z);scene.add(e);};
  mk(COLS+6,.35,0,-ROWS/2-2); mk(COLS+6,.35,0,ROWS/2+2);
  mk(.35,ROWS+6,-COLS/2-2,0); mk(.35,ROWS+6,COLS/2+2,0);
}

/* ---- racks ---- */
const BOXCOL=[0x8a6a45,0x6d573b,0x2e6f6a,0x54606e,0x96693a,0x7a4a33];
const uprightG=new THREE.BoxGeometry(.09,3,.09), upMat=new THREE.MeshStandardMaterial({color:0x2f6db5,roughness:.6,metalness:.3});
const beamMat=new THREE.MeshStandardMaterial({color:0xc96f2a,roughness:.7});
const plankMat=new THREE.MeshStandardMaterial({color:0x2b3844,roughness:.9});
RACK_ROWS.forEach(([r0])=>SEGS.forEach(([c0,c1])=>{
  const a=W(c0,r0),b=W(c1,r0+1);
  const cx=(a.x+b.x)/2, cz=(a.z+b.z)/2, len=b.x-a.x+1;
  const grp=new THREE.Group();
  const beamG=new THREE.BoxGeometry(len,.07,.09), plankG=new THREE.BoxGeometry(len,.04,1.86);
  [.95,1.9].forEach(y=>{
    [-0.93,0.93].forEach(zz=>{const bm=new THREE.Mesh(beamG,beamMat);bm.position.set(0,y,zz);bm.castShadow=true;grp.add(bm);});
    const pl=new THREE.Mesh(plankG,plankMat);pl.position.y=y+.03;grp.add(pl);
  });
  for(let x=-len/2+.1;x<=len/2;x+=2.2)
    [-0.95,0.95].forEach(zz=>{const u=new THREE.Mesh(uprightG,upMat);u.position.set(x,1.5,zz);u.castShadow=true;grp.add(u);});
  [0,.98,1.93].forEach(ly=>{
    for(let x=-len/2+.65;x<len/2-.3;x+=1.15){
      if(Math.random()<.28)continue;
      const h=rnd(.45,.75),w=rnd(.75,.95);
      const bx=new THREE.Mesh(new THREE.BoxGeometry(w,h,.85),new THREE.MeshStandardMaterial({color:pick(BOXCOL),roughness:.9}));
      bx.position.set(x,ly+h/2,rnd(-.3,.3)); grp.add(bx);
    }
  });
  grp.position.set(cx,0,cz); scene.add(grp);
}));

/* ---- text sprite helper ---- */
function textSprite(draw,w,h,sx,sy){
  const cv=document.createElement('canvas');cv.width=w;cv.height=h;
  const tex=new THREE.CanvasTexture(cv);tex.encoding=THREE.sRGBEncoding;
  const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:tex,transparent:true,depthWrite:false}));
  sp.scale.set(sx,sy,1); sp.userData.redraw=()=>{const g=cv.getContext('2d');g.clearRect(0,0,w,h);draw(g,w,h);tex.needsUpdate=true;};
  sp.userData.redraw(); return sp;
}
const CIRC=(()=>{const cv=document.createElement('canvas');cv.width=cv.height=32;const g=cv.getContext('2d');
  const gr=g.createRadialGradient(16,16,0,16,16,15);gr.addColorStop(0,'rgba(255,255,255,1)');gr.addColorStop(.4,'rgba(255,255,255,.5)');gr.addColorStop(1,'rgba(255,255,255,0)');
  g.fillStyle=gr;g.fillRect(0,0,32,32);return new THREE.CanvasTexture(cv);})();

/* ---- charge pads / stations / gateway ---- */
PADS.forEach(p=>{
  const w=W(p.c,p.r),g=new THREE.Group();
  const base=new THREE.Mesh(new THREE.BoxGeometry(1,.06,1),new THREE.MeshStandardMaterial({color:0x17242e,roughness:.8}));base.position.y=.03;g.add(base);
  const ring=new THREE.Mesh(new THREE.RingGeometry(.36,.44,32),new THREE.MeshBasicMaterial({color:0xffb454,transparent:true,opacity:.7,side:THREE.DoubleSide}));
  ring.rotation.x=-Math.PI/2;ring.position.y=.07;g.add(ring);
  const bolt=textSprite((c)=>{c.font='30px sans-serif';c.textAlign='center';c.fillStyle='#ffb454';c.fillText('⚡',24,34);},48,48,.5,.5);bolt.position.y=.85;g.add(bolt);
  const lb=textSprite((c)=>{c.font='600 20px Chakra Petch, sans-serif';c.textAlign='center';c.fillStyle='#8ba0b2';c.fillText('C'+(p.i+1),32,26);},64,32,.9,.45);lb.position.y=1.35;g.add(lb);
  const pulse=new THREE.Mesh(new THREE.RingGeometry(.4,.48,32),new THREE.MeshBasicMaterial({color:0xffb454,transparent:true,opacity:0,side:THREE.DoubleSide}));
  pulse.rotation.x=-Math.PI/2;pulse.position.y=.08;g.add(pulse);p.pulse=pulse;
  g.position.set(w.x,0,w.z);scene.add(g);p.mesh=g;
});
STNS.forEach(s=>{
  const w=W(s.c,s.r),g=new THREE.Group();
  const body=new THREE.Mesh(new THREE.BoxGeometry(1.7,.75,1.1),new THREE.MeshStandardMaterial({color:0x24313f,roughness:.7}));
  body.position.y=.375;body.castShadow=true;g.add(body);
  const top=new THREE.Mesh(new THREE.BoxGeometry(1.74,.06,1.14),new THREE.MeshStandardMaterial({color:0x31414f,roughness:.5}));top.position.y=.78;g.add(top);
  const led=new THREE.Mesh(new THREE.BoxGeometry(1.5,.05,.03),new THREE.MeshBasicMaterial({color:0x4fd8eb}));led.position.set(0,.55,.57);g.add(led);
  const lb=textSprite((c)=>{c.font='700 22px Chakra Petch, sans-serif';c.textAlign='center';c.fillStyle='#4fd8eb';c.fillText('STN '+(s.i+1),64,30);},128,40,1.5,.47);lb.position.y=1.5;g.add(lb);
  g.position.set(w.x,0,w.z);scene.add(g);
  const ap=W(s.ap.c,s.ap.r);
  const mk=new THREE.Mesh(new THREE.RingGeometry(.32,.4,4),new THREE.MeshBasicMaterial({color:0x4fd8eb,transparent:true,opacity:.5,side:THREE.DoubleSide}));
  mk.rotation.x=-Math.PI/2;mk.rotation.z=Math.PI/4;mk.position.set(ap.x,.05,ap.z);scene.add(mk);
});
const gatePos=W(GATE.c,GATE.r), gateG=new THREE.Group();
{
  const base=new THREE.Mesh(new THREE.BoxGeometry(.7,.22,.7),new THREE.MeshStandardMaterial({color:0x1a2836}));base.position.y=.11;gateG.add(base);
  const pole=new THREE.Mesh(new THREE.CylinderGeometry(.05,.07,2.3,8),new THREE.MeshStandardMaterial({color:0x33475c}));pole.position.y=1.3;gateG.add(pole);
  const box=new THREE.Mesh(new THREE.BoxGeometry(.42,.5,.3),new THREE.MeshStandardMaterial({color:0x14232e,emissive:0x1e6f86,emissiveIntensity:.9}));box.position.y=2.05;gateG.add(box);
  const tip=new THREE.Mesh(new THREE.SphereGeometry(.07,10,10),new THREE.MeshBasicMaterial({color:0x4fd8eb}));tip.position.y=2.65;gateG.add(tip);
  const lb=textSprite((c)=>{c.font='600 17px Chakra Petch, sans-serif';c.textAlign='center';c.fillStyle='#7be0f0';c.fillText('EDGE GATEWAY · GW-01',160,24);},320,36,3.1,.35);lb.position.y=3.1;gateG.add(lb);
  const gr=new THREE.Mesh(new THREE.RingGeometry(.9,1,48),new THREE.MeshBasicMaterial({color:0x4fd8eb,transparent:true,opacity:.3,side:THREE.DoubleSide}));
  gr.rotation.x=-Math.PI/2;gr.position.y=.06;gateG.add(gr);gateG.userData.ring=gr;
  const gl=new THREE.PointLight(0x4fd8eb,.7,9);gl.position.y=2.3;gateG.add(gl);
  gateG.position.set(gatePos.x,0,gatePos.z);scene.add(gateG);
}
/* dust */
const dust=(()=>{const n=240,p=new Float32Array(n*3);
  for(let i=0;i<n;i++){p[i*3]=rnd(-COLS/2,COLS/2);p[i*3+1]=rnd(.3,7);p[i*3+2]=rnd(-ROWS/2,ROWS/2);}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(p,3));
  const pts=new THREE.Points(g,new THREE.PointsMaterial({color:0x6a8b98,size:.06,transparent:true,opacity:.3,depthWrite:false}));
  scene.add(pts);return pts;})();

/* ================= ROBOTS ================= */
const STCOL={Moving:0x41e0a3,Idle:0x7d8ea0,Charging:0xffb454,Blocked:0xff5d6c};
const PRINAME={1:'CRITICAL',2:'HIGH',3:'NORMAL',4:'LOW'};
const robots=[], hitMeshes=[];
function buildBot(id){
  const g=new THREE.Group();
  const skirt=new THREE.Mesh(new THREE.BoxGeometry(.8,.16,.64),new THREE.MeshStandardMaterial({color:0x1c2530,roughness:.6}));skirt.position.y=.1;skirt.castShadow=true;g.add(skirt);
  const body=new THREE.Mesh(new THREE.BoxGeometry(.7,.24,.56),new THREE.MeshStandardMaterial({color:0x2e3a47,roughness:.5,metalness:.2}));body.position.y=.3;body.castShadow=true;g.add(body);
  const top=new THREE.Mesh(new THREE.BoxGeometry(.54,.06,.42),new THREE.MeshStandardMaterial({color:0x46586b,roughness:.4,metalness:.3}));top.position.y=.45;g.add(top);
  [.31,-.31].forEach(z=>{const b=new THREE.Mesh(new THREE.BoxGeometry(.74,.09,.05),new THREE.MeshStandardMaterial({color:0xd97a2b,roughness:.6}));b.position.set(0,.12,z);g.add(b);});
  const lid=new THREE.Mesh(new THREE.CylinderGeometry(.09,.11,.1,14),new THREE.MeshStandardMaterial({color:0x11161c,roughness:.3}));lid.position.y=.54;g.add(lid);
  const spin=new THREE.Mesh(new THREE.CylinderGeometry(.055,.055,.05,6),new THREE.MeshBasicMaterial({color:0x66ffcc}));spin.position.y=.62;g.add(spin);g.userData.spin=spin;
  const led=new THREE.Mesh(new THREE.BoxGeometry(.6,.045,.02),new THREE.MeshBasicMaterial({color:0x41e0a3}));led.position.set(0,.34,.29);g.add(led);g.userData.led=led;
  const ring=new THREE.Mesh(new THREE.RingGeometry(.5,.62,36),new THREE.MeshBasicMaterial({color:0x41e0a3,transparent:true,opacity:.75,side:THREE.DoubleSide}));
  ring.rotation.x=-Math.PI/2;ring.position.y=.03;g.add(ring);g.userData.ring=ring;
  const sel=new THREE.Mesh(new THREE.RingGeometry(.72,.79,40),new THREE.MeshBasicMaterial({color:0xffb454,transparent:true,opacity:.9,side:THREE.DoubleSide}));
  sel.rotation.x=-Math.PI/2;sel.position.y=.04;sel.visible=false;g.add(sel);g.userData.sel=sel;
  const hit=new THREE.Mesh(new THREE.BoxGeometry(1.1,1.5,1.1),new THREE.MeshBasicMaterial({transparent:true,opacity:0,depthWrite:false}));
  hit.position.y=.75;g.add(hit);
  const label=textSprite(()=>{},256,104,2.3,.94);label.position.y=1.55;g.add(label);g.userData.label=label;
  // path line + flow dot + dest marker
  const pline=new THREE.Line(new THREE.BufferGeometry(),new THREE.LineDashedMaterial({color:0x4fd8eb,dashSize:.35,gapSize:.2,transparent:true,opacity:.8}));
  scene.add(pline);
  const dot=new THREE.Mesh(new THREE.SphereGeometry(.08,8,8),new THREE.MeshBasicMaterial({color:0x9feaf7}));dot.visible=false;scene.add(dot);
  const dm=new THREE.Group();
  const dr=new THREE.Mesh(new THREE.RingGeometry(.24,.34,24),new THREE.MeshBasicMaterial({color:0x4fd8eb,transparent:true,opacity:.8,side:THREE.DoubleSide}));
  dr.rotation.x=-Math.PI/2;dr.position.y=.05;dm.add(dr);
  const beam=new THREE.Mesh(new THREE.CylinderGeometry(.05,.14,1.6,10,1,true),new THREE.MeshBasicMaterial({color:0x4fd8eb,transparent:true,opacity:.22,blending:THREE.AdditiveBlending,depthWrite:false,side:THREE.DoubleSide}));
  beam.position.y=.8;dm.add(beam);dm.visible=false;scene.add(dm);
  return {g,hit,pline,dot,dm};
}
function drawLabel(b){
  const key=b.status+'|'+b.id+'|'+b.intentShort;
  if(b._lk===key)return; b._lk=key;
  const col='#'+STCOL[b.status].toString(16).padStart(6,'0');
  b.g.userData.label.userData.redraw=(g)=>{
    g.fillStyle='rgba(8,14,19,.88)';g.fillRect(18,10,220,84);
    g.strokeStyle=col;g.lineWidth=3;g.strokeRect(18,10,220,84);
    g.fillStyle='#eef4f8';g.font='700 34px Chakra Petch, sans-serif';g.textAlign='center';g.fillText(b.id,128,48);
    g.fillStyle=col;g.font='500 19px IBM Plex Mono, monospace';g.fillText(b.intentShort||b.status.toUpperCase(),128,78);
    b.g.userData.label.material.map.needsUpdate=true;
  };
  b.g.userData.label.userData.redraw();
}
const SPAWN=[[20,25],[23,25],[26,25],[29,25],[24,23],[28,23]];
for(let i=0;i<6;i++){
  const v=buildBot(); const w=W(SPAWN[i][0],SPAWN[i][1]);
  const b={id:'AMR-0'+(i+1),g:v.g,hit:v.hit,pline:v.pline,dot:v.dot,dm:v.dm,
    pos:new THREE.Vector3(w.x,0,w.z),vel:new THREE.Vector3(),speed:0,heading:0,
    battery:i===4?17:rnd(55,96),priority:i===3?1:(i===5?4:(i===0?2:3)),
    state:'idle',order:null,pad:null,pendingOrder:null,halted:false,
    path:[],seg:0,cum:[],destCell:null,destName:'—',
    intent:'IDLE — AWAITING TASK',intentShort:'IDLE',status:'Idle',
    fc:null,yieldTo:null,speedK:1,dwell:0,dwellNext:null,replanT:0,tempBlocks:null,
    link:{rssi:-52,q:1,blocked:0},orderTimer:0,_lk:''};
  v.hit.userData.bot=b; hitMeshes.push(v.hit);
  b.g.position.copy(b.pos); scene.add(b.g); robots.push(b);
}
function setPath(b,cells){
  b.path=simplify(cells).map(c=>W(c.c,c.r));
  b.seg=0;b.cum=[0];
  for(let i=1;i<b.path.length;i++)b.cum[i]=b.cum[i-1]+Math.hypot(b.path[i].x-b.path[i-1].x,b.path[i].z-b.path[i-1].z);
  const pts=b.path.map(p=>new THREE.Vector3(p.x,.12,p.z));
  b.pline.geometry.dispose();b.pline.geometry=new THREE.BufferGeometry().setFromPoints(pts);
  b.pline.computeLineDistances();
  b.dot.visible=b.path.length>1;
}
function remaining(b){
  if(!b.path.length||b.seg>=b.path.length-1)return 0;
  const wp=b.path[b.seg+1];
  return Math.hypot(wp.x-b.pos.x,wp.z-b.pos.z)+(b.cum[b.cum.length-1]-b.cum[b.seg+1]);
}
function pointAlong(b,t){
  const L=b.cum[b.cum.length-1]||1;let d=(t%1)*L;
  for(let i=1;i<b.cum.length;i++){if(b.cum[i]>=d){const s=(d-b.cum[i-1])/(b.cum[i]-b.cum[i-1]);
    return{x:lerp(b.path[i-1].x,b.path[i].x,s),z:lerp(b.path[i-1].z,b.path[i].z,s)};} }
  return b.path[b.path.length-1];
}

/* ================= UI STATE ================= */
let selected=null,camMode='ORBIT',paused=false,speed=1,simT=0,ordersDone=0;
const logEl=document.getElementById('log');
function log(cat,msg){
  const d=document.createElement('div');d.className='ln';
  d.innerHTML=`<span class="t">${fmtT(34860+simT)}</span><span class="tag ${cat}">${cat}</span><span class="m">${msg}</span>`;
  logEl.prepend(d);
  while(logEl.children.length>70)logEl.lastChild.remove();
}
const rosterEl=document.getElementById('roster'),rosterRows={};
robots.forEach(b=>{
  const d=document.createElement('div');d.className='unit';
  d.innerHTML=`<span class="u-dot"></span><div class="u-main">
    <div class="u-top"><b>${b.id}</b><span class="badge">—</span><span class="u-cf" style="display:none">⚠</span><span class="pri"></span></div>
    <div class="u-task">—</div>
    <div class="u-batt"><div class="bar"><i></i></div><em>—</em></div></div>`;
  d.onclick=()=>select(b);
  rosterEl.appendChild(d);rosterRows[b.id]=d;
});
document.getElementById('unitCount').textContent=robots.length+' UNITS';
function select(b){
  if(selected)selected.g.userData.sel.visible=false;
  selected=b;
  Object.values(rosterRows).forEach(r=>r.classList.remove('sel'));
  if(b){rosterRows[b.id].classList.add('sel');b.g.userData.sel.visible=true;}
  document.getElementById('inspEmpty').style.display=b?'none':'block';
  document.getElementById('inspBody').style.display=b?'block':'none';
  if(b&&camMode==='FOLLOW')camTarget.set(b.pos.x,0,b.pos.z);
}
select(robots[0]);

/* ================= ORDERS / TASKS ================= */
let ordSeq=1040;
function assignOrder(b,quiet){
  const pk=pick(PICKS),st=pick(STNS);
  b.order={id:'ORD-'+(ordSeq++),pick:pk,st,pickTag:sector(pk.c,pk.r)};
  b.state='toPick';b.destCell=pk;b.destName='PICK '+pk.c+'·'+pk.r+' ('+sector(pk.c,pk.r)+')';
  const p=astar(...cellXY(b),pk.c,pk.r,b.tempBlocks);
  if(p)setPath(b,p);else{b.state='idle';b.order=null;return;}
  b.dm.position.set(W(pk.c,pk.r).x,0,W(pk.c,pk.r).z);b.dm.visible=true;
  if(!quiet)log('TSK',`${b.id} assigned ${b.order.id} · PICK ${pk.c}·${pk.r} → STN ${st.i+1}`);
}
function cellXY(b){const c=cellOf(b.pos.x,b.pos.z);return[c.c,c.r];}
function goCharge(b,recall){
  if(b.state==='charging')return;
  const free=PADS.filter(p=>!p.occ||p.occ===b);
  if(!free.length){if(recall)b.intent='ALL DOCKS OCCUPIED — HOLD';return;}
  free.sort((a,c)=>Math.hypot(a.c-cellXY(b)[0],a.r-cellXY(b)[1])-Math.hypot(c.c-cellXY(b)[0],c.r-cellXY(b)[1]));
  const pad=free[0];
  if(b.order){b.pendingOrder=b.order;b.order=null;}
  pad.occ=b;b.pad=pad;b.state='toCharge';
  b.destCell={c:pad.c,r:pad.r};b.destName='CHARGE DOCK C'+(pad.i+1);
  const p=astar(...cellXY(b),pad.c,pad.r,b.tempBlocks);
  if(p){setPath(b,p);b.dm.position.set(W(pad.c,pad.r).x,0,W(pad.c,pad.r).z);b.dm.visible=true;}
  if(recall)log('PWR',`${b.id} recalled to dock C${pad.i+1} · batt ${b.battery.toFixed(0)}%`);
}
function onArrive(b){
  if(b.state==='toPick'){b.state='dwell';b.dwell=1.7;b.dwellNext='toDrop';b.intent='PICKING LOAD…';b.intentShort='PICKING';}
  else if(b.state==='toDrop'){b.state='dwell';b.dwell=1.5;b.dwellNext='done';b.intent='DEPOSITING…';b.intentShort='DROP-OFF';}
  else if(b.state==='toCharge'){b.state='charging';b.intent='DOCKED — CHARGING';b.intentShort='CHARGING';log('PWR',`${b.id} docked at C${b.pad.i+1} · fast-charge engaged`);}
  b.dm.visible=false;
}
function finishOrder(b){
  ordersDone++;
  log('TSK',`${b.order.id} complete · delivered to STN ${b.order.st.i+1} · throughput ↑`);
  b.order=null;b.state='idle';b.orderTimer=rnd(1.2,4);
}

/* ================= OBSTACLES ================= */
const obstacles=[];
function spawnObstacle(manual){
  const cand=[];
  for(let r=4;r<=22;r++)for(let c=5;c<=36;c++)
    if(freeCell(c,r)&&robots.every(b=>Math.hypot(W(c,r).x-b.pos.x,W(c,r).z-b.pos.z)>4))cand.push({c,r});
  if(!cand.length)return;
  const cell=pick(cand),w=W(cell.c,cell.r);
  const g=new THREE.Group();
  const crate=new THREE.Mesh(new THREE.BoxGeometry(.62,.55,.62),new THREE.MeshStandardMaterial({color:0xb06a2c,roughness:.85}));
  crate.position.y=.28;crate.rotation.y=rnd(0,3);crate.castShadow=true;g.add(crate);
  const strap=new THREE.Mesh(new THREE.BoxGeometry(.66,.1,.66),new THREE.MeshStandardMaterial({color:0x33231a}));strap.position.y=.32;g.add(strap);
  const warn=textSprite((c)=>{c.font='700 34px sans-serif';c.textAlign='center';c.fillStyle='#ff5d6c';c.fillText('!',24,38);},48,48,.5,.5);
  warn.position.y=1.05;g.add(warn);
  g.position.set(w.x,0,w.z);g.scale.set(.01,.01,.01);scene.add(g);
  const o={c:cell.c,r:cell.r,g,life:rnd(10,15),warn};
  obstacles.push(o);DYN.add(CI(cell.c,cell.r));
  const near=robots.filter(b=>Math.hypot(w.x-b.pos.x,w.z-b.pos.z)<8).map(b=>b.id).join(', ');
  log('NAV',`OBSTACLE detected @ ${cell.c}·${cell.r} (${sector(cell.c,cell.r)}) · LiDAR cluster${near?' · '+near+' replanning':''}${manual?' [manual inject]':''}`);
}
function removeObstacle(o,silent){
  DYN.delete(CI(o.c,o.r));scene.remove(o.g);
  obstacles.splice(obstacles.indexOf(o),1);
  if(!silent)log('NAV',`obstacle @ ${o.c}·${o.r} cleared by floor crew`);
  robots.forEach(b=>{if(b.blockedWait)b.replanT=0;});
}

/* ================= CONFLICTS ================= */
let forced=null;const pairSeen={};
const zones=[];for(let i=0;i<5;i++){
  const grp=new THREE.Group();
  const r1=new THREE.Mesh(new THREE.RingGeometry(1,1.14,40),new THREE.MeshBasicMaterial({color:0xff5d6c,transparent:true,opacity:.8,side:THREE.DoubleSide}));
  const r2=new THREE.Mesh(new THREE.CircleGeometry(1,40),new THREE.MeshBasicMaterial({color:0xff5d6c,transparent:true,opacity:.07,side:THREE.DoubleSide}));
  r1.rotation.x=r2.rotation.x=-Math.PI/2;r1.position.y=r2.position.y=.05;grp.add(r1,r2);
  grp.visible=false;scene.add(grp);zones.push(grp);
}
const negLines=[];for(let i=0;i<3;i++){
  const l=new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(),new THREE.Vector3()]),
    new THREE.LineBasicMaterial({color:0xffb454,transparent:true,opacity:.5}));
  l.visible=false;scene.add(l);negLines.push(l);
}
function injectDeadlock(){
  if(forced){log('SYS','inject rejected — arbitration already in progress');return;}
  const cands=robots.filter(b=>b.state!=='charging'&&!b.halted&&!(b.state==='forced'));
  if(cands.length<2)return;
  const a=pick(cands);let b=pick(cands);while(b===a)b=pick(cands);
  const Lr=Math.floor(rnd(8,19)),L={c:17,r:Lr};
  [a,b].forEach((r,i)=>{
    r._savedState=r.state;r._savedOrder=r.order;r._savedDest=r.destCell;
    r.state='forced';r.order=null;r.dm.visible=false;
    const side=i===0?Lr-4:Lr+4,other=i===0?Lr+4:Lr-4;
    const appr=astar(...cellXY(r),17,side,r.tempBlocks);
    const cells=appr||[{c:17,r:side}];
    const dir=Math.sign(other-side);
    for(let rr=side;rr!==other;rr+=dir)cells.push({c:17,r:rr});
    setPath(r,cells);r.tempBlocks=null;
  });
  forced={a,b,L,phase:'approach',t:0,dur:rnd(3.6,5),loser:null,logged:{}};
  log('ARB',`corridor contention predicted @ AISLE-17/R${Lr} · ${a.id} ⇄ ${b.id} dispatched cross-sector`);
}
function updForced(dt){
  if(!forced)return;
  const{a,b,L}=forced;forced.t+=dt;
  const d=a.pos.distanceTo(b.pos);
  if(forced.phase==='approach'){
    [a,b].forEach(r=>{r.intent='TRAVERSING AISLE-17';r.intentShort='EN ROUTE';});
    if(d<2.35){
      forced.phase='standoff';forced.t=0;
      a.fc=b.fc='DEADLOCK';a.status=b.status='Blocked';
      a.intent=b.intent='NEGOTIATING · V2V ARBITRATION';a.intentShort=b.intentShort='NEGOTIATING';
      log('ARB',`DEADLOCK ${a.id} ⇄ ${b.id} @ ${sector(L.c,L.r)} · head-on in aisle — edge consensus started`);
    }
  }else if(forced.phase==='standoff'){
    [a,b].forEach(r=>{r.speed=0;r.intent='NEGOTIATING · V2V ARBITRATION';});
    if(!forced.logged.p1&&forced.t>0.8){forced.logged.p1=1;log('COM',`${a.id} ⇄ ${b.id} exchanging intent vectors over mesh (${rnd(8,14).toFixed(0)} ms RTT)`);}
    if(!forced.logged.p2&&forced.t>2){forced.logged.p2=1;log('ARB',`priority vector: ${a.id}=P${a.priority} (${PRINAME[a.priority]}) · ${b.id}=P${b.priority} (${PRINAME[b.priority]})`);}
    if(forced.t>=forced.dur){
      const loser=a.priority>b.priority?a:(b.priority>a.priority?b:(a.speed<b.speed?a:b));
      const winner=loser===a?b:a;forced.loser=loser;
      loser.tempBlocks=new Set();for(let rr=L.r-3;rr<=L.r+3;rr++)loser.tempBlocks.add(CI(17,rr));
      const goal=loser._savedDest&&loser._savedState!=='idle'?loser._savedDest:{c:Math.floor(rnd(8,34)),r:loser.pos.z<0?23:4};
      const p=astar(...cellXY(loser),goal.c,goal.r,loser.tempBlocks);
      if(p){setPath(loser,p);loser.destCell=goal;loser.destName=sector(goal.c,goal.r);}
      loser.state='forced-clear';loser.intent='REROUTING — YIELDED (P'+loser.priority+')';loser.intentShort='REROUTING';
      winner.intent='PROCEEDING — RIGHT OF WAY';
      forced.phase='resolving';
      log('ARB',`verdict: ${loser.id} yields &amp; reroutes · ${winner.id} holds right-of-way`);
      document.getElementById('arbTxt').innerHTML=`<b>${a.id}</b> (P${a.priority}) ⇄ <b>${b.id}</b> (P${b.priority}) @ ${sector(L.c,L.r)} → <b>${loser.id}</b> rerouted by priority arbitration`;
    }
  }else if(forced.phase==='resolving'){
    a.intentShort=a.state==='forced'?'PROCEEDING':a.intentShort;
    if(d>5.5){
      [a,b].forEach(r=>{
        r.tempBlocks=null;
        if(r._savedOrder){r.order=r._savedOrder;
          const tgt=r._savedState==='toPick'?r.order.pick:r.order.st.ap;
          r.state=r._savedState;r.destCell=tgt;
          const p=astar(...cellXY(r),tgt.c,tgt.r,null);
          if(p){setPath(r,p);r.dm.position.set(W(tgt.c,tgt.r).x,0,W(tgt.c,tgt.r).z);r.dm.visible=true;}
          else r.state='idle';
        }else{r.state='idle';r.orderTimer=rnd(1,3);}
        r.fc=null;
      });
      log('ARB',`conflict resolved @ ${sector(L.c,L.r)} · corridor AISLE-17 reopened`);
      forced=null;
    }
  }
}
function updConflicts(dt){
  robots.forEach(b=>{if(b.fc!=='DEADLOCK')b.fc=null;b.yieldTo=null;b.speedK=1;});
  let zi=0,li=0;
  const pairs=[];
  for(let i=0;i<robots.length;i++)for(let j=i+1;j<robots.length;j++){
    const a=robots[i],c=robots[j];
    if(forced&&(a===forced.a||a===forced.b||c===forced.a||c===forced.b))continue;
    const d=a.pos.distanceTo(c.pos);
    if(d<3.6&&a.speed>.15&&c.speed>.15){
      const key=a.id+c.id;
      const closer=((c.pos.x-a.pos.x)*(a.vel.x-c.vel.x)+(c.pos.z-a.pos.z)*(a.vel.z-c.vel.z))>0||d<2.2;
      if(!closer&&d>2.2)continue;
      pairs.push([a,c,d]);
      a.fc=a.fc==='DEADLOCK'?'DEADLOCK':'POTENTIAL';c.fc=c.fc==='DEADLOCK'?'DEADLOCK':'POTENTIAL';
      const yielder=a.priority>c.priority?a:(c.priority>a.priority?c:(a.id>c.id?a:c));
      const other=yielder===a?c:a;
      yielder.yieldTo=other.id;yielder.speedK=d<2.1?0:.3;
      yielder.intent='YIELDING TO '+other.id;yielder.intentShort='YIELDING';
      if(!pairSeen[key]){pairSeen[key]=1;
        log('ARB',`proximity conflict predicted ${a.id} ⇄ ${c.id} @ ${sector(...Object.values(cellOf((a.pos.x+c.pos.x)/2,(a.pos.z+c.pos.z)/2)))} · ${yielder.id} yields (P${yielder.priority})`);}
      if(zi<zones.length){const z=zones[zi++];z.visible=ovZones;z.position.set((a.pos.x+c.pos.x)/2,.0,(a.pos.z+c.pos.z)/2);
        z.children.forEach(m=>m.material.color.setHex(0xffd75e));z.userData.s=.6;}
      if(li<negLines.length){const l=negLines[li++];l.visible=ovMesh;
        l.geometry.setFromPoints([new THREE.Vector3(a.pos.x,.9,a.pos.z),new THREE.Vector3(c.pos.x,.9,c.pos.z)]);
        l.material.color.setHex(0xffb454);l.material.opacity=.45;}
    }else if(d>4.2){delete pairSeen[a.id+c.id];}
  }
  if(forced&&forced.phase!=='approach'){
    const mid=new THREE.Vector3().addVectors(forced.a.pos,forced.b.pos).multiplyScalar(.5);
    if(zi<zones.length){const z=zones[zi++];z.visible=ovZones;z.position.set(mid.x,0,mid.z);
      z.children.forEach(m=>m.material.color.setHex(0xff5d6c));z.userData.s=1;}
    if(li<negLines.length){const l=negLines[li++];l.visible=true;
      l.geometry.setFromPoints([new THREE.Vector3(forced.a.pos.x,.9,forced.a.pos.z),new THREE.Vector3(forced.b.pos.x,.9,forced.b.pos.z)]);
      l.material.color.setHex(0xff5d6c);l.material.opacity=.55+Math.sin(simT*8)*.3;}
  }
  for(;zi<zones.length;zi++)zones[zi].visible=false;
  for(;li<negLines.length;li++)negLines[li].visible=false;
  return pairs;
}

/* ================= COMMS ================= */
const meshLines=[];for(let i=0;i<16;i++){
  const l=new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(),new THREE.Vector3()]),
    new THREE.LineBasicMaterial({color:0x4fd8eb,transparent:true,opacity:.2}));
  l.visible=false;scene.add(l);meshLines.push(l);
}
const pulses=[];for(let i=0;i<8;i++){
  const s=new THREE.Sprite(new THREE.SpriteMaterial({map:CIRC,color:0x9feaf7,transparent:true,opacity:.9,depthWrite:false}));
  s.scale.set(.22,.22,1);s.visible=false;scene.add(s);pulses.push({s,t:Math.random(),link:null});
}
let gwLinks=[],meshHealth=100,meshT=0,rfTimer=rnd(10,18);
function updComms(dt){
  meshT-=dt;rfTimer-=dt;
  if(rfTimer<0){const b=pick(robots);b.link.blocked=rnd(2.5,4);rfTimer=rnd(12,22);
    log('COM',`${b.id} link degraded — RF shadow behind rack (${sector(...Object.values(cellOf(b.pos.x,b.pos.z)))})`);}
  if(meshT>0)return;meshT=.3;
  gwLinks=[];let li=0,qSum=0;
  robots.forEach(b=>{
    if(b.link.blocked>0)b.link.blocked-=.3;
    const d=Math.hypot(gatePos.x-b.pos.x,gatePos.z-b.pos.z);
    let rssi=-(38+d*1.5+rnd(0,5))-(b.link.blocked>0?26:0);
    b.link.rssi=rssi;b.link.q=clamp((rssi+94)/46,0,1);qSum+=b.link.q;
    if(d<36&&li<meshLines.length){
      const l=meshLines[li++];l.visible=ovMesh;
      l.geometry.setFromPoints([new THREE.Vector3(gatePos.x,2,gatePos.z),new THREE.Vector3(b.pos.x,.9,b.pos.z)]);
      l.material.opacity=.05+.28*b.link.q;
      gwLinks.push({a:new THREE.Vector3(gatePos.x,2,gatePos.z),b:b,q:b.link.q});
    }
  });
  for(let i=0;i<robots.length;i++)for(let j=i+1;j<robots.length&&li<meshLines.length;j++){
    const a=robots[i],c=robots[j],d=a.pos.distanceTo(c.pos);
    if(d<13){const l=meshLines[li++];l.visible=ovMesh;
      l.geometry.setFromPoints([new THREE.Vector3(a.pos.x,.9,a.pos.z),new THREE.Vector3(c.pos.x,.9,c.pos.z)]);
      l.material.opacity=.14;}
  }
  for(;li<meshLines.length;li++)meshLines[li].visible=false;
  meshHealth=qSum/robots.length*100;
  document.getElementById('gwStat').textContent=meshHealth>75?'ONLINE':meshHealth>45?'DEGRADED':'LOSS';
}

/* ================= SIM UPDATE ================= */
function driveBot(b,dt){
  if(!b.path.length||b.seg>=b.path.length-1){b.speed=lerp(b.speed,0,Math.min(1,dt*6));return b.path.length&&b.seg>=b.path.length-1;}
  const wp=b.path[b.seg+1];
  const dx=wp.x-b.pos.x,dz=wp.z-b.pos.z,d=Math.hypot(dx,dz);
  const rem=remaining(b);
  let vmax=1.65;
  if(b.seg+2<b.path.length){ // corner ahead
    const a1=Math.atan2(dz,dx),n=b.path[b.seg+2];
    const a2=Math.atan2(n.z-wp.z,n.x-wp.x);
    let da=Math.abs(a2-a1);if(da>Math.PI)da=2*Math.PI-da;
    if(da>0.8&&d<1.1)vmax=.75;
  }
  vmax=Math.min(vmax,.35+rem*.85);
  let k=b.speedK;
  if(b.yieldTo&&b.speedK===0&&b.speed<.05)b.intent='WAITING CLEARANCE';
  // obstacle ahead check
  for(const o of obstacles){
    const ow=W(o.c,o.r),odx=ow.x-b.pos.x,odz=ow.z-b.pos.z,od=Math.hypot(odx,odz);
    if(od<2.4){
      const fwd=(Math.cos(b.heading)*odx+Math.sin(b.heading)*odz)/od;
      if(fwd>0.72){
        if(b.replanT<=0){b.replanT=1.4;
          const goal=b.destCell,p=goal&&astar(...cellXY(b),goal.c,goal.r,b.tempBlocks);
          if(p&&p.length>1){setPath(b,p);b.intent='OBSTRUCTED — REPLANNING';b.intentShort='REPLANNING';
            log('NAV',`${b.id} replanning around obstacle @ ${o.c}·${o.r}`);return false;}
          else{b.blockedWait=true;b.intent='OBSTRUCTED — NO ROUTE';b.intentShort='OBSTRUCTED';}
        }
        k=0;
      }
    }
  }
  const vt=vmax*k;
  b.speed=lerp(b.speed,vt,Math.min(1,dt*4));
  if(b.speed>0.02){
    b.heading=Math.atan2(dx,dz);
    b.g.rotation.y=b.heading;
    const step=Math.min(b.speed*dt,d);
    b.pos.x+=dx/d*step;b.pos.z+=dz/d*step;
    if(d-step<.02)b.seg++;
  }
  if(b.seg>=b.path.length-1)return true;
  return false;
}
function updBot(b,dt){
  b.replanT-=dt;
  b.battery-=(b.speed>.05?.15:.028)*dt*(b.speed>.05?1:1);
  b.battery=Math.max(0,b.battery);
  if(b.halted){b.speed=lerp(b.speed,0,dt*8);b.intent='MANUAL E-STOP';b.intentShort='E-STOP';return;}
  if(b.state==='forced'||b.state==='forced-clear'){
    if(b.state==='forced-clear'){if(driveBot(b,dt)){b.state='idle';b.orderTimer=rnd(1,3);}}
    return;
  }
  if(b.state==='charging'){
    b.speed=0;b.battery=Math.min(100,b.battery+4.2*dt);
    b.intent='CHARGING · '+b.battery.toFixed(0)+'%';b.intentShort='CHARGING';
    if(b.battery>=96){
      b.pad.occ=null;b.pad=null;b.state='idle';
      log('PWR',`${b.id} charge complete · returning to pool`);
      if(b.pendingOrder){const o=b.pendingOrder;b.pendingOrder=null;b.order=o;
        const tgt=b.state==='toDrop'?o.st.ap:o.pick;
        b.state='toPick';b.destCell=o.pick;
        const p=astar(...cellXY(b),o.pick.c,o.pick.r,null);
        if(p){setPath(b,p);b.dm.position.set(W(o.pick.c,o.pick.r).x,0,W(o.pick.c,o.pick.r).z);b.dm.visible=true;}else b.state='idle';
      }else b.orderTimer=rnd(.5,2);
    }
    return;
  }
  if(b.state==='dwell'){
    b.speed=0;b.dwell-=dt;
    if(b.dwell<=0){
      if(b.dwellNext==='toDrop'){
        const st=b.order.st;b.state='toDrop';b.destCell=st.ap;b.destName='STN '+(st.i+1);
        const p=astar(...cellXY(b),st.ap.c,st.ap.r,b.tempBlocks);
        if(p){setPath(b,p);b.dm.position.set(W(st.ap.c,st.ap.r).x,0,W(st.ap.c,st.ap.r).z);b.dm.visible=true;}
        b.intent='TRANSPORTING LOAD';
      }else if(b.dwellNext==='done')finishOrder(b);
    }
    return;
  }
  if(b.battery<21&&b.state!=='toCharge'){log('PWR',`${b.id} battery low (${b.battery.toFixed(0)}%) — auto-docking`);goCharge(b,false);}
  if(b.state==='idle'){
    b.orderTimer-=dt;
    if(b.orderTimer<=0)assignOrder(b,false);
    return;
  }
  const arrived=driveBot(b,dt);
  if(arrived)onArrive(b);
  else if(!b.yieldTo&&b.speed>.1){b.intent=b.state==='toPick'?'NAVIGATING TO PICK':b.state==='toDrop'?'DELIVERING TO STN '+(b.order?b.order.st.i+1:''):'TRANSIT TO DOCK';b.intentShort=b.state==='toCharge'?'TO DOCK':'EN ROUTE';}
}
function deriveStatus(b){
  if(b.halted||(forced&&(forced.a===b||forced.b===b)&&forced.phase==='standoff')||b.blockedWait)b.status='Blocked';
  else if(b.state==='charging')b.status='Charging';
  else if(b.speed>.06)b.status='Moving';
  else b.status='Idle';
  b.blockedWait=b.blockedWait&&b.speed<.02;
  if(!b.blockedWait&&b.status!=='Blocked')b.blockedWait=false;
}

/* ================= CAMERA ================= */
const camTarget=new THREE.Vector3(0,0,1);
let cTheta=.5,cPhi=.92,cRad=27,tTheta=.5,tPhi=.92,tRad=27;
const camGoal=new THREE.Vector3(0,0,1);
let dragging=0,lx=0,ly=0,downX=0,downY=0;
const cnv=renderer.domElement;
cnv.addEventListener('contextmenu',e=>e.preventDefault());
cnv.addEventListener('pointerdown',e=>{dragging=e.button===2?2:1;lx=e.clientX;ly=e.clientY;downX=e.clientX;downY=e.clientY;cnv.setPointerCapture(e.pointerId);});
cnv.addEventListener('pointerup',e=>{
  if(Math.hypot(e.clientX-downX,e.clientY-downY)<5&&e.button===0)pickAt(e);
  dragging=0;
});
cnv.addEventListener('pointermove',e=>{
  mouse.x=(e.clientX-vp.getBoundingClientRect().left)/vp.clientWidth*2-1;
  mouse.y=-((e.clientY-vp.getBoundingClientRect().top)/vp.clientHeight)*2+1;
  mouseCX=e.clientX;mouseCY=e.clientY;
  if(!dragging)return;
  const dx=e.clientX-lx,dy=e.clientY-ly;lx=e.clientX;ly=e.clientY;
  if(dragging===1&&!e.shiftKey){tTheta-=dx*.005;tPhi=clamp(tPhi-dy*.004,.16,1.35);if(camMode!=='ORBIT')setCam('ORBIT');}
  else{
    camera.updateMatrixWorld();
    const right=new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld,0);
    const fwd=new THREE.Vector3().crossVectors(new THREE.Vector3(0,1,0),right);
    const s=cRad*.0016;
    camGoal.addScaledVector(right,-dx*s).addScaledVector(fwd,dy*s);
    camGoal.x=clamp(camGoal.x,-24,24);camGoal.z=clamp(camGoal.z,-18,18);
    if(camMode==='FOLLOW')setCam('ORBIT');
  }
});
cnv.addEventListener('wheel',e=>{e.preventDefault();tRad=clamp(tRad*Math.exp(e.deltaY*.0011),8,55);},{passive:false});
cnv.addEventListener('dblclick',e=>{const b=raycastBot(e);if(b){select(b);setCam('FOLLOW');}});
const ray=new THREE.Raycaster(),mouse=new THREE.Vector2(-9,-9);let mouseCX=0,mouseCY=0;
function raycastBot(e){
  const r=vp.getBoundingClientRect();
  mouse.x=(e.clientX-r.left)/r.clientWidth*2-1;mouse.y=-((e.clientY-r.top)/r.clientHeight)*2+1;
  ray.setFromCamera(mouse,camera);
  const h=ray.intersectObjects(hitMeshes,false);
  return h.length?h[0].object.userData.bot:null;
}
function pickAt(e){const b=raycastBot(e);select(b);}
function setCam(m){
  camMode=m;document.getElementById('hudCam').textContent=m;
  document.querySelectorAll('[data-cam]').forEach(x=>x.classList.toggle('on',x.dataset.cam===m));
  if(m==='TOP'){tPhi=.16;tRad=36;camGoal.set(0,0,0);}
  if(m==='FOLLOW'&&!selected)select(robots[0]);
  if(m==='ORBIT')tPhi=Math.max(tPhi,.3);
}
function updCam(dt){
  if(camMode==='FOLLOW'&&selected){camGoal.set(selected.pos.x,0,selected.pos.z);tRad=Math.min(tRad,16);}
  camTarget.lerp(camGoal,Math.min(1,dt*6));
  cTheta=lerp(cTheta,tTheta,Math.min(1,dt*7));cPhi=lerp(cPhi,tPhi,Math.min(1,dt*7));cRad=lerp(cRad,tRad,Math.min(1,dt*7));
  camera.position.set(
    camTarget.x+cRad*Math.sin(cPhi)*Math.sin(cTheta),
    camTarget.y+cRad*Math.cos(cPhi),
    camTarget.z+cRad*Math.sin(cPhi)*Math.cos(cTheta));
  camera.lookAt(camTarget);
}

/* ================= OVERLAYS / UI EVENTS ================= */
let ovPaths=true,ovLabels=true,ovMesh=true,ovZones=true;
document.querySelectorAll('[data-ov]').forEach(cb=>cb.onchange=()=>{
  const k=cb.dataset.ov,v=cb.checked;
  if(k==='paths'){ovPaths=v;robots.forEach(b=>{b.pline.visible=v;b.dot.visible=v&&b.path.length>1;});}
  if(k==='labels'){ovLabels=v;robots.forEach(b=>b.g.userData.label.visible=v);}
  if(k==='mesh')ovMesh=v;
  if(k==='zones')ovZones=v;
});
document.querySelectorAll('[data-cam]').forEach(x=>x.onclick=()=>setCam(x.dataset.cam));
const pauseBtn=document.getElementById('pauseBtn');
function togglePause(){paused=!paused;pauseBtn.textContent=paused?'▶':'❚❚';log('SYS',paused?'simulation paused by operator':'simulation resumed');}
pauseBtn.onclick=togglePause;
const spdBtn=document.getElementById('spdBtn');const SPDS=[1,2,4,.5];let spdI=0;
spdBtn.onclick=()=>{spdI=(spdI+1)%SPDS.length;speed=SPDS[spdI];spdBtn.textContent=(speed+'×').replace('0.5','½');log('SYS','sim rate set to '+speed+'×');};
document.getElementById('btnDispatch').onclick=()=>{robots.filter(b=>b.state==='idle').forEach((b,i)=>setTimeout(()=>{if(b.state==='idle')assignOrder(b,false);},i*400));log('SYS','dispatch wave issued to idle units');};
document.getElementById('btnObs').onclick=()=>spawnObstacle(true);
document.getElementById('btnDead').onclick=injectDeadlock;
document.getElementById('btnRecall').onclick=()=>{robots.forEach(b=>{if(b.state!=='charging'){b.pendingOrder=null;goCharge(b,true);}});log('SYS','fleet recall — all units to charge docks');};
document.getElementById('btnResume').onclick=()=>{robots.forEach(b=>b.halted=false);log('SYS','all E-stops cleared — fleet released');};
document.getElementById('btnHalt').onclick=()=>{if(!selected)return;selected.halted=!selected.halted;log('SYS',selected.id+(selected.halted?' E-STOP engaged':' E-STOP released'));};
document.getElementById('btnCharge').onclick=()=>{if(!selected)return;selected.pendingOrder=null;goCharge(selected,true);};
document.getElementById('priUp').onclick=()=>{if(selected&&selected.priority>1){selected.priority--;log('SYS',selected.id+' priority raised to P'+selected.priority);}};
document.getElementById('priDn').onclick=()=>{if(selected&&selected.priority<4){selected.priority++;log('SYS',selected.id+' priority lowered to P'+selected.priority);}};
addEventListener('keydown',e=>{
  if(e.code==='Space'&&e.target===document.body){e.preventDefault();togglePause();}
  if(e.key==='f'||e.key==='F')setCam('FOLLOW');
});

/* ================= UI REFRESH ================= */
const $=id=>document.getElementById(id);
function refreshRoster(){
  robots.forEach(b=>{
    const r=rosterRows[b.id];
    r.querySelector('.u-dot').className='u-dot st-'+b.status;
    const bd=r.querySelector('.badge');bd.textContent=b.status.toUpperCase();bd.className='badge st-'+b.status;
    r.querySelector('.pri').textContent='P'+b.priority;r.querySelector('.pri').className='pri p'+b.priority;
    r.querySelector('.u-cf').style.display=b.fc?'inline':'none';
    r.querySelector('.u-task').textContent=(b.order?b.order.id+' · ':'')+(b.intent||'—');
    const bar=r.querySelector('.u-batt .bar'),fill=bar.querySelector('i'),em=r.querySelector('.u-batt em');
    fill.style.width=b.battery+'%';
    bar.className='bar'+(b.battery<22?' crit':b.battery<45?' warn':'');
    em.textContent=b.battery.toFixed(0)+'%';
  });
}
function refreshInspector(){
  if(!selected)return;const b=selected;
  $('iId').textContent=b.id;
  $('iStat').textContent=b.status.toUpperCase();$('iStat').className='badge st-'+b.status;
  $('iPri').textContent='P'+b.priority;$('iPri').className='pri p'+b.priority;
  $('iIntent').textContent=b.intent||'—';
  $('iPriV').textContent='P'+b.priority+' · '+PRINAME[b.priority];
  const bb=$('iBattBar');bb.style.width=b.battery+'%';
  bb.style.background=b.battery<22?'var(--red)':b.battery<45?'var(--amb)':'var(--grn)';
  $('iBatt').textContent=b.battery.toFixed(1)+'%';
  $('iVel').textContent=b.speed.toFixed(2)+' m/s';
  const cc=cellOf(b.pos.x,b.pos.z);
  $('iPos').innerHTML=`C${cc.c}·R${cc.r} <small>(${b.pos.x.toFixed(1)}, ${b.pos.z.toFixed(1)}) · ${sector(cc.c,cc.r)}</small>`;
  $('iDest').textContent=b.path.length?b.destName:'— none —';
  $('iTask').textContent=b.order?b.order.id+' · PICK '+b.order.pickTag+' → STN '+(b.order.st.i+1):(b.state==='toCharge'?'AUTO-DOCK':b.pendingOrder?'QUEUED · '+b.pendingOrder.id:'—');
  $('iEta').textContent=b.speed>.1?remaining(b)/Math.max(.5,b.speed)+' s':(b.path.length?'holding':'—');
  const bars=$('iRssi').children,q=b.link.q;
  for(let i=0;i<4;i++)bars[i].classList.toggle('on',q>(i+1)/4-.12);
  $('iDbm').innerHTML=b.link.rssi.toFixed(0)+' dBm <small>'+(b.link.blocked>0?'· DEGRADED':'· OK')+'</small>';
  $('iConf').innerHTML=b.fc==='DEADLOCK'?'<span style="color:var(--red)">■ DEADLOCK — ARBITRATING</span>':b.fc==='POTENTIAL'?'<span style="color:var(--yel)">■ POTENTIAL — YIELDING</span>':'<span style="color:#3f7a5f">none</span>';
  $('btnHalt').textContent=b.halted?'Release':'E-Stop';
  $('btnHalt').className='btn '+(b.halted?'ok':'warn');
}
let uiT=0,kpiT=0;
function refreshKPIs(){
  const mv=robots.filter(b=>b.status==='Moving').length;
  $('kFleet').innerHTML=mv+'<span class="sub"> /'+robots.length+'</span>';
  $('kOrders').textContent=ordersDone;
  const conf=(forced&&forced.phase!=='approach'?1:0)+robots.filter(b=>b.fc==='POTENTIAL').length;
  $('kConf').textContent=conf;$('kConfBox').classList.toggle('alert',conf>0);
  $('kBatt').textContent=(robots.reduce((s,b)=>s+b.battery,0)/robots.length).toFixed(0)+'%';
  $('kMesh').textContent=meshHealth.toFixed(0)+'%';
  $('kThr').innerHTML=(simT>30?(ordersDone/simT*3600).toFixed(1):'—')+'<span class="sub"> /hr</span>';
  $('hdrClock').textContent=fmtT(34860+simT);
}
function refreshConflictMon(){
  const el=$('cmList');let html='';
  if(forced&&forced.phase!=='approach'){
    html+=`<div class="cfCard"><b>DEADLOCK · ${sector(forced.L.c,forced.L.r)}</b>
    <span><em>${forced.a.id}</em> ⇄ <em>${forced.b.id}</em> · AISLE-17<br>state: ${forced.phase==='standoff'?'V2V ARBITRATION ('+Math.max(0,forced.dur-forced.t).toFixed(1)+'s)':'RESOLVING — REROUTE'}</span></div>`;
  }
  const seen={};
  robots.forEach(b=>{if(b.fc==='POTENTIAL'&&b.yieldTo){const k=[b.id,b.yieldTo].sort().join('');
    if(seen[k])return;seen[k]=1;
    html+=`<div class="cfCard pot"><b>POTENTIAL · PROXIMITY</b><span><em>${b.id}</em> yielding to <em>${b.yieldTo}</em> · priority arbitration</span></div>`;}});
  el.innerHTML=html||'<div class="cfEmpty">NO ACTIVE CONFLICTS<br>FLEET NOMINAL</div>';
  const n=(forced?1:0)+Object.keys(seen).length;
  $('cmCount').textContent=n+' ACTIVE';
}
const banner=$('banner');
function refreshBanner(){
  const on=forced&&forced.phase!=='approach';
  banner.classList.toggle('show',!!on);
  if(on){
    $('bnTitle').textContent='DEADLOCK DETECTED · '+sector(forced.L.c,forced.L.r);
    $('bnSub').textContent=forced.a.id+' ⇄ '+forced.b.id+' · '+(forced.phase==='standoff'?'edge arbitration in progress…':'resolution executing — reroute in progress');
    $('bnProg').style.width=(forced.phase==='standoff'?clamp(forced.t/forced.dur,0,1)*100:100)+'%';
  }
}

/* ================= TOOLTIP ================= */
const tip=$('tip');let hoverBot=null;
function updHover(){
  ray.setFromCamera(mouse,camera);
  const h=ray.intersectObjects(hitMeshes,false);
  hoverBot=h.length?h[0].object.userData.bot:null;
  cnv.style.cursor=hoverBot?'pointer':(dragging?'grabbing':'grab');
  if(hoverBot&&!dragging){
    const b=hoverBot;
    tip.style.display='block';
    tip.style.left=(mouseCX+16)+'px';tip.style.top=(mouseCY+14)+'px';
    tip.innerHTML=`<b>${b.id}</b> · ${b.status.toUpperCase()}<br>BATT ${b.battery.toFixed(0)}% · ${b.speed.toFixed(2)} m/s · P${b.priority}<br>${b.intent}`;
  }else tip.style.display='none';
}

/* ================= MAIN LOOP ================= */
let lastT=performance.now(),fpsN=0,fpsT=0,obstT=rnd(14,22),autoDead=rnd(40,60);
function resize(){
  const w=vp.clientWidth,h=vp.clientHeight;
  renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(vp);resize();
function frame(now){
  requestAnimationFrame(frame);
  const raw=Math.min(.05,(now-lastT)/1000);lastT=now;
  fpsN++;fpsT+=raw;if(fpsT>.5){$('fps').textContent=Math.round(fpsN/fpsT);fpsN=0;fpsT=0;}
  const dt=paused?0:raw*speed;
  if(dt>0){
    simT+=dt;
    robots.forEach(b=>updBot(b,dt));
    updForced(dt);
    updConflicts(dt);
    robots.forEach(deriveStatus);
    updComms(dt);
    obstacles.forEach(o=>{o.life-=dt;o.g.scale.setScalar(Math.min(1,o.g.scale.x+dt*4));o.warn.position.y=1.05+Math.sin(simT*4)*.06;});
    for(let i=obstacles.length-1;i>=0;i--)if(obstacles[i].life<=0){obstacles[i].g.scale.x<.95?null:0;
      if(obstacles[i].life<-0.01){const s=obstacles[i].g.scale.x-dt*3;if(s<=0.02)removeObstacle(obstacles[i]);else obstacles[i].g.scale.setScalar(s);obstacles[i].life=-0.02;} }
    obstT-=dt;if(obstT<=0){spawnObstacle(false);obstT=rnd(18,32);}
    autoDead-=dt;if(autoDead<=0){if(!forced)injectDeadlock();autoDead=rnd(55,85);}
  }
  // visuals
  robots.forEach(b=>{
    b.g.position.set(b.pos.x,0,b.pos.z);
    b.g.userData.spin.rotation.y+=raw*9;
    const col=b.fc==='DEADLOCK'?0xff5d6c:(b.fc==='POTENTIAL'?0xffd75e:STCOL[b.status]);
    b.g.userData.led.material.color.setHex(col);
    b.g.userData.ring.material.color.setHex(col);
    b.g.userData.ring.material.opacity=.55+Math.sin(now*.004)*.2;
    if(b===selected)b.g.userData.sel.rotation.z+=raw*1.5;
    drawLabel(b);
    b.pline.visible=ovPaths&&b.path.length>1&&b.seg<b.path.length-1;
    if(b.dot.visible&&b.path.length>1){
      b._ft=((b._ft||0)+dt*b.speed/Math.max(1,b.cum[b.cum.length-1]))%1;
      const p=pointAlong(b,b._ft);b.dot.position.set(p.x,.12,p.z);b.dot.visible=ovPaths;
    }
  });
  zones.forEach(z=>{if(z.visible){const s=(z.userData.s||1)*(1+Math.sin(now*.005)*.14);z.scale.setScalar(s);
    z.children[0].material.opacity=.55+Math.sin(now*.006)*.3;}});
  {const r=gateG.userData.ring;const t=(now*.0004)%1;r.scale.setScalar(.6+t*7);r.material.opacity=(1-t)*.35;}
  PADS.forEach(p=>{const on=p.occ&&p.occ.state==='charging';
    p.pulse.material.opacity=on?(.5+Math.sin(now*.006)*.3):0;
    if(on)p.pulse.scale.setScalar(1+((now*.0012)%1)*.8);});
  pulses.forEach(p=>{
    if(!gwLinks.length){p.s.visible=false;return;}
    if(!p.link||Math.random()<.002)p.link=pick(gwLinks);
    if(!ovMesh){p.s.visible=false;return;}
    p.t+=raw*.8;if(p.t>1){p.t=0;p.link=pick(gwLinks);}
    p.s.visible=true;
    p.s.position.lerpVectors(p.link.a,p.link.b,p.t);
    p.s.material.opacity=p.link.q*.9;
  });
  dust.rotation.y+=raw*.004;
  uiT+=raw;if(uiT>.25){uiT=0;refreshRoster();refreshInspector();refreshConflictMon();refreshBanner();}
  kpiT+=raw;if(kpiT>.5){kpiT=0;refreshKPIs();}
  updHover();
  updCam(raw);
  renderer.render(scene,camera);
}
requestAnimationFrame(frame);

/* boot */
log('SYS','FLEETGRID edge runtime v2.4 · digital twin synchronised');
setTimeout(()=>log('SYS','mesh network formed · 6 nodes + GW-01 · consensus layer ready'),400);
setTimeout(()=>log('NAV','warehouse map loaded · SECTOR W-07 · 4 rack rows · 4 charge docks · 3 stations'),800);
setTimeout(()=>{assignOrder(robots[0]);assignOrder(robots[1]);assignOrder(robots[2]);assignOrder(robots[3]);robots[5].orderTimer=rnd(2,4);goCharge(robots[4],false);},1100);
setTimeout(()=>document.getElementById('intro').classList.add('gone'),1200);

