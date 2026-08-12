/* Perch — customizable home, widgets, gallery, runtimes, overview panels, storage.
   Part of the frontend, split positionally from one file: the
   scripts are loaded in order and share one global scope, so
   execution order is exactly as it was. */
/* ===== fully customizable home ==============================================
   Every item on the Overview tab — the stat tiles and the panels alike — is a
   widget in one grid: reorder by dragging, resize S/M/L/full, remove, and add
   more from the gallery. `core:1` widgets have their markup in index.html (the
   loaders elsewhere in this file own their contents); the rest are rendered
   here from an existing API. Layout lives in localStorage.perchHome.        */

const HOME_ROWS=rows=>`<div class="hwbody">${rows.join("")||
  '<span class="muted">nothing to show</span>'}</div>`;
const HOME_ROW=(left,right)=>`<div class="r"><div class="g">${left}</div>
  <div class="num">${right||""}</div></div>`;
const HOME_HEAD=(title,extra)=>`<h2>${title}${extra||""}</h2>`;
const goLink=(tab,label)=>`<button class="btn small" data-goto-tab="${tab}"
  style="margin-left:8px">${label}</button>`;
// widgets whose data is expensive to gather load once and refresh on demand
const reloadBtn=id=>`<button class="btn small" data-hwreload="${id}"
  style="margin-left:8px" title="refresh now">↻</button>`;

const HOME_WIDGETS={
  /* --- core: markup already in the page, filled in by the loaders above --- */
  cpu:{icon:"🔥",title:"CPU",desc:"Live load with a sparkline",core:1,size:"s"},
  mem:{icon:"🧠",title:"Memory",desc:"Used, total and swap",core:1,size:"s"},
  net:{icon:"🌐",title:"Network",desc:"Up/down throughput",core:1,size:"s"},
  gpu:{icon:"🎮",title:"GPU",desc:"Clock, busy % and top consumer",core:1,size:"s"},
  core:{icon:"📶",title:"Per-core load",desc:"A bar per CPU core",core:1,size:"s"},
  disk:{icon:"💽",title:"Disk I/O",desc:"Read and write throughput",core:1,size:"s"},
  temp:{icon:"🌡️",title:"Temperature",desc:"Hottest sensor over time",core:1,size:"s"},
  battery:{icon:"🔋",title:"Battery",desc:"Charge, health and cycles",core:1,size:"s"},
  uptime:{icon:"⏱️",title:"Uptime",desc:"Uptime, load average, process count",core:1,size:"s"},
  search:{icon:"🔍",title:"Find a file",desc:"Search the whole system by name",core:1,size:"full"},
  health:{icon:"🩺",title:"Health check",desc:"Score out of 100 with one-click fixes",core:1,size:"full"},
  critlogs:{icon:"⚠",title:"Needs attention",desc:"Recent errors from the system log",core:1,size:"full"},
  hw:{icon:"💻",title:"This laptop",desc:"Model, BIOS, CPU/GPU, battery health, Wi-Fi",core:1,size:"full"},

  /* ------------------------- gallery: opt-in widgets ------------------------ */
  procs:{icon:"⚙️",title:"Top processes",desc:"Busiest processes by CPU",
    size:"m",every:8000,
    load:async()=>{const p=await api("/api/processes?sort=cpu");
      return HOME_HEAD("⚙️ Top processes",goLink("proc","open"))+
        HOME_ROWS(p.slice(0,6).map(x=>HOME_ROW(
          `<b>${esc(x.name)}</b> <span class="muted mono">${x.pid}</span>`,
          `${x.cpu.toFixed(0)}% · ${fmtB(x.mem)}`)));}},
  disks:{icon:"💾",title:"Disk usage",desc:"How full each mounted disk is",
    size:"m",every:60000,
    load:async()=>{const ds=await api("/api/disks");
      return HOME_HEAD("💾 Disk usage",goLink("storage","open"))+
        HOME_ROWS(ds.slice(0,6).map(d=>HOME_ROW(
          `<b class="mono">${esc(d.mount)}</b>
           <div class="bar" style="margin-top:3px"><i style="width:${d.percent}%;
             background:${usageColor(d.percent)}"></i></div>`,
          `${d.percent.toFixed(0)}%<div class="muted" style="font-size:11px">
             ${fmtB(d.free)} free</div>`)));}},
  ports:{icon:"🔌",title:"Listening ports",desc:"What is listening, and where",
    size:"m",every:15000,
    load:async()=>{const n=await api("/api/net");
      const pub=n.listen.filter(p=>p.public).length;
      return HOME_HEAD("🔌 Listening ports",
        `<span class="muted"> — ${n.listen.length} open, ${pub} network-visible</span>`+
        goLink("net","open"))+
        HOME_ROWS(n.listen.slice(0,7).map(p=>HOME_ROW(
          `<b>${p.port}</b> <span class="muted">${esc(p.name||"—")}</span>`,
          p.public?'<span class="pill">⚠ public</span>':
            '<span class="muted">local</span>')));}},
  containers:{icon:"🐳",title:"Containers & pods",desc:"Docker, Podman, LXD and Kubernetes",
    size:"m",every:60000,
    load:async()=>{const d=await api("/api/containers");
      const rows=[];
      for(const e of d.envs){
        const up=e.containers.filter(c=>c.state==="running").length;
        rows.push(HOME_ROW(`<b>${esc(e.engine)}</b>`,
          `${up}/${e.containers.length} up`));
        e.containers.filter(c=>c.state==="running").slice(0,3).forEach(c=>
          rows.push(HOME_ROW(`<span class="muted">&nbsp;&nbsp;🟢 ${esc(c.name)}</span>`,
            `<span class="mono" style="font-size:10.5px">${esc(c.ports||"")}</span>`)));
      }
      if(d.k8s)rows.push(HOME_ROW(`<b>kubernetes</b>
        <span class="muted">${esc(d.k8s.context||"")}</span>`,
        d.k8s.error?'<span class="muted">unreachable</span>'
          :`${d.k8s.pods.filter(p=>p.phase==="Running").length}/${d.k8s.pods.length} running`));
      return HOME_HEAD("🐳 Containers & pods",goLink("dev","open"))+HOME_ROWS(rows);}},
  alerts:{icon:"🚨",title:"Recent alerts",desc:"Latest fired alerts and the master switch",
    size:"m",every:30000,
    load:async()=>{const m=await api("/api/monitor?brief=1");
      const on=m.ctl&&m.ctl.enabled!==false;
      return HOME_HEAD(`🚨 Recent alerts <span class="muted">— ${
        on?"alerting on":"alerting stopped"}</span>`,goLink("monitor","open"))+
        HOME_ROWS(m.events.slice(0,5).map(e=>HOME_ROW(
          `<span class="pill">${esc(e.rule)}</span> ${esc(e.msg)}`,
          `<span class="muted">${ago(e.t)}</span>`))
          .concat(m.events.length?[]:['<span style="color:var(--goodtext)">nothing has fired 🎉</span>']));}},
  updates:{icon:"📦",title:"Pending updates",desc:"Packages waiting to be upgraded",
    size:"m",every:300000,
    load:async()=>{const u=await api("/api/updates");
      return HOME_HEAD("📦 Pending updates",goLink("updates","open"))+
        (u.count?HOME_ROWS([HOME_ROW(
          `<b>${u.count}</b> upgradable${u.security?
            ` · <span style="color:var(--crit)">${u.security} security</span>`:""}`,"")]
          .concat(u.packages.slice(0,5).map(p=>HOME_ROW(
            `<span class="muted">${esc(p.name)}</span>`,
            `<span class="mono" style="font-size:10.5px">${esc(p.new)}</span>`))))
          :'<div class="hwbody"><span style="color:var(--goodtext)">everything is up to date 🎉</span></div>');}},
  services:{icon:"🧩",title:"Failed services",desc:"systemd units that need a look",
    size:"m",every:60000,
    load:async()=>{const s=await api("/api/services");
      const bad=s.failed_system.map(f=>HOME_ROW(
        `<span style="color:var(--crit)">🔴 ${esc(f.name)}</span>`,""))
        .concat(s.user.filter(u=>u.active==="failed").map(u=>HOME_ROW(
          `<span style="color:var(--crit)">🔴 ${esc(u.name)}</span>`,
          '<span class="muted">user</span>')));
      return HOME_HEAD("🧩 Failed services",goLink("dev","open"))+
        (bad.length?HOME_ROWS(bad.slice(0,7))
          :'<div class="hwbody"><span style="color:var(--goodtext)">no failed services 🎉</span></div>');}},
  gitrepos:{icon:"🔀",title:"Git repositories",desc:"Repos with uncommitted work",
    size:"m",every:0,
    load:async()=>{const g=await api("/api/gitrepos");
      const dirty=(g.repos||[]).filter(r=>r.dirty||r.ahead||r.behind);
      return HOME_HEAD("🔀 Git repositories",
        `<span class="muted"> — ${dirty.length} of ${(g.repos||[]).length} need attention</span>`+
        reloadBtn("gitrepos")+goLink("git","open"))+
        HOME_ROWS(dirty.slice(0,6).map(r=>HOME_ROW(
          `<b>${esc(r.name)}</b> <span class="muted">${esc(r.branch||"")}</span>`,
          [r.dirty?`${r.dirty} changed`:"",r.ahead?`↑${r.ahead}`:"",
           r.behind?`↓${r.behind}`:""].filter(Boolean).join(" · "))));}},
  cleanup:{icon:"🧹",title:"Reclaimable space",desc:"What a cleanup would free",
    size:"m",every:0,
    load:async()=>{const c=await api("/api/cleanup");
      const t=(c.targets||[]);
      return HOME_HEAD("🧹 Reclaimable space",
        `<span class="muted"> — ${fmtB(t.reduce((a,x)=>a+(x.size||0),0))} total</span>`+
        reloadBtn("cleanup")+goLink("clean","open"))+
        HOME_ROWS(t.filter(x=>x.size).slice(0,6).map(x=>HOME_ROW(
          esc(x.label||x.id),fmtB(x.size))));}},
  actions:{icon:"⚡",title:"Quick actions",desc:"One-click shortcuts you use often",
    size:"m",every:0,
    load:async()=>HOME_HEAD("⚡ Quick actions")+
      `<div class="row" style="margin:0;gap:6px">
        <button class="btn small" data-qa="term">🖥 Terminal</button>
        <button class="btn small" data-qa="note">📝 New note</button>
        <button class="btn small" data-qa="sketch">🎨 Sketch</button>
        <button class="btn small" data-qa="speed">🚀 Speed test</button>
        <button class="btn small" data-qa="clean">🧹 Clean up</button>
        <button class="btn small" data-qa="index">🔁 Rebuild index</button>
        <button class="btn small" data-qa="health">🩺 Re-check health</button>
      </div>`},
  notes:{icon:"📝",title:"Scratchpad",desc:"A quick note kept in this browser",
    size:"m",every:0,
    load:async()=>HOME_HEAD("📝 Scratchpad",
      '<span class="muted" id="npStat" style="font-size:11.5px"></span>')+
      `<textarea id="ovNotes" class="tin" style="height:120px"
        placeholder="Jot anything — saved as you type">${esc(localStorage.perchNotes||"")}</textarea>`},
  clock:{icon:"🕒",title:"Clock",desc:"Local time and date",size:"s",every:1000,
    load:async()=>{const d=new Date();
      return `<div class="k">${d.toLocaleDateString([],{weekday:"long"})}</div>
        <div class="v">${d.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}</div>
        <div class="d">${d.toLocaleDateString([],{day:"numeric",month:"long",year:"numeric"})}</div>`;},
    card:1},
  ifaces:{icon:"🖧",title:"Network interfaces",desc:"NICs and their IP addresses",
    size:"m",every:60000,
    load:async()=>{const n=await api("/api/net");
      return HOME_HEAD("🖧 Network interfaces",goLink("net","open"))+
        HOME_ROWS(n.ifaces.map(i=>HOME_ROW(
          `${i.up?"🟢":"⚪"} <b>${esc(i.nic)}</b>`,
          `<span class="mono" style="font-size:11px">${i.ips.map(esc).join(", ")}</span>`)));}},
};
const HOME_DEFAULT=["cpu","mem","net","gpu","core","disk","temp","battery",
  "uptime","search","health","critlogs","hw"];
const HOME_SIZES=["s","m","l","full"];
const HOME_SIZE_LABEL={s:"S",m:"M",l:"L",full:"▭"};

/* The server holds the authoritative layout (~/.config/perch/home.json) so it
   follows you to another browser; localStorage stays as an offline cache and
   the fallback when the server has never been written to. */
let homeSynced=false;
async function homeLoadRemote(){
  try{
    const r=await api("/api/homelayout");
    if(r.layout&&(r.layout.order||[]).length){
      localStorage.perchHome=JSON.stringify(r.layout);
      applyHome();
    }else{
      // first run on this machine: seed the server from whatever this browser has
      const local=localStorage.perchHome;
      if(local)homeSaveRemote(JSON.parse(local));
    }
  }catch(e){/* offline or older server — the localStorage copy still works */}
  homeSynced=true;
}
let homeSaveTimer=null;
function homeSaveRemote(layout){
  clearTimeout(homeSaveTimer);
  homeSaveTimer=setTimeout(()=>{
    api("/api/homelayout",{method:"POST",body:JSON.stringify({layout})})
      .catch(()=>{});
  },600);
}
/* single place that persists a layout: browser cache + server */
function homeWrite(st){
  localStorage.perchHome=JSON.stringify(st);
  homeSaveRemote(st);
}
function homeState(){
  let st=null;
  try{st=JSON.parse(localStorage.perchHome||"null");}catch(e){}
  if(!st){
    // migrate the older tiles-only layout so existing users keep their home
    let old=null;
    try{old=JSON.parse(localStorage.perchTiles||"null");}catch(e){}
    st=old?{order:(old.order||[]).concat(HOME_DEFAULT.filter(
        id=>!(old.order||[]).includes(id))),
      hidden:(old.hidden||[]).slice(),sizes:{}}
      :{order:HOME_DEFAULT.slice(),hidden:[],sizes:{}};
  }
  st.order=st.order||[];st.hidden=st.hidden||[];st.sizes=st.sizes||{};
  return st;
}
function saveHome(){
  const grid=$("#ovGrid");if(!grid)return;
  const st=homeState();
  const shown=[...grid.children].filter(el=>el.dataset.w&&
    !el.classList.contains("hw-off")).map(el=>el.dataset.w);
  st.order=shown.concat(st.order.filter(id=>!shown.includes(id)));
  st.hidden=Object.keys(HOME_WIDGETS).filter(id=>!shown.includes(id));
  [...grid.children].forEach(el=>{
    if(el.dataset.w&&el.dataset.cols)st.sizes[el.dataset.w]=widgetSize(el);});
  homeWrite(st);
}
function homeEl(id){
  const grid=$("#ovGrid");
  let el=grid.querySelector(`[data-w="${CSS.escape(id)}"]`);
  if(el)return el;
  const w=HOME_WIDGETS[id];if(!w||w.core)return null;
  el=document.createElement("div");
  el.className=w.card?"card":"panel";
  el.dataset.w=id;
  el.innerHTML='<div class="muted" style="font-size:12.5px">loading…</div>';
  delete hwLast[id];          // a re-added widget must render straight away
  grid.appendChild(el);
  return el;
}
function applyHome(){
  const grid=$("#ovGrid");if(!grid)return;
  const st=homeState();
  const order=st.order.filter(id=>HOME_WIDGETS[id]&&!st.hidden.includes(id));
  order.forEach(id=>{
    const el=homeEl(id);if(!el)return;
    applyWidgetSize(el,sizeOf(id,el));
    el.classList.remove("hw-off");
    grid.appendChild(el);                       // re-append = move into order
  });
  // hidden core widgets stay in the DOM (their loaders keep writing to them)
  [...grid.children].forEach(el=>{
    const id=el.dataset.w;
    if(id&&!order.includes(id)){
      if(HOME_WIDGETS[id]&&HOME_WIDGETS[id].core)el.classList.add("hw-off");
      else el.remove();
    }
  });
  ovDecorate();
  refreshHome();
}
/* ---- rendering & refresh of the non-core widgets ---- */
const hwLast={};
async function renderWidget(id,force){
  const w=HOME_WIDGETS[id];
  if(!w||w.core||!w.load)return;
  const el=$("#ovGrid").querySelector(`[data-w="${CSS.escape(id)}"]`);
  if(!el||el.classList.contains("hw-off"))return;
  const now=Date.now();
  // never rendered → always render; otherwise honour the widget's own cadence
  // (every:0 means "load once", refreshed by its ↻ button)
  if(!force&&hwLast[id]&&(!w.every||now-hwLast[id]<w.every))return;
  hwLast[id]=now;
  try{
    const html=await w.load();
    const ctl=el.querySelector(".hwctl");
    el.innerHTML=html;
    if(ctl)el.appendChild(ctl);                    // keep the edit controls
    el.querySelectorAll("[data-goto-tab]").forEach(b=>
      b.onclick=e=>{e.stopPropagation();goTab(b.dataset.gotoTab);});
    el.querySelectorAll("[data-hwreload]").forEach(b=>
      b.onclick=e=>{e.stopPropagation();renderWidget(b.dataset.hwreload,true);});
    hookWidgetExtras(id,el);
  }catch(e){
    el.innerHTML=`<div class="muted" style="font-size:12.5px">
      ${esc(w.title)} unavailable — ${esc(e.message)}</div>`;
  }
}
function hookWidgetExtras(id,el){
  if(id==="actions")el.querySelectorAll("[data-qa]").forEach(b=>b.onclick=()=>({
    term:()=>goTab("term"),
    note:()=>{goTab("files");$("#newFile").click();},
    sketch:()=>{goTab("files");$("#newSketch").click();},
    speed:()=>{goTab("net");$("#speedGo").click();},
    clean:()=>goTab("clean"),
    index:()=>$("#reindex").click(),
    health:()=>{loadHealth();toast("re-checking health");},
  }[b.dataset.qa]||(()=>{}))());
  if(id==="notes"){
    const t=el.querySelector("#ovNotes");
    t.oninput=()=>{localStorage.perchNotes=t.value;
      const s=el.querySelector("#npStat");if(s)s.textContent="saved";};
  }
}
function refreshHome(){
  if(!$("#tab-overview").classList.contains("on")||document.hidden)return;
  homeState().order.forEach(id=>renderWidget(id));
}
setInterval(refreshHome,5000);

/* ---- edit mode: drag to move, drag the corner to resize ---- */
let ovEditing=false,dragEl=null;
const ROW_UNIT=130;            // px of height one "row" of a widget is worth
const MAX_SPAN=6;

function gridMetrics(){
  const g=$("#ovGrid"),cs=getComputedStyle(g);
  const tracks=cs.gridTemplateColumns.split(" ").filter(Boolean).map(parseFloat)
    .filter(n=>!isNaN(n));
  return {cols:Math.max(1,tracks.length),trackW:tracks[0]||220,
          gap:parseFloat(cs.columnGap)||14};
}
/* sizes are stored as {w,h}; the older s/m/l/full strings still load */
function sizeOf(id,el){
  const raw=(homeState().sizes||{})[id];
  if(raw&&typeof raw==="object")
    return {w:raw.w||1,h:Math.max(1,Math.min(MAX_SPAN,raw.h||1))};
  const legacy={s:1,m:2,l:3,full:"full"};
  const def=HOME_WIDGETS[id]&&HOME_WIDGETS[id].size;
  return {w:legacy[raw||def||"s"]||1,h:1};
}
function applyWidgetSize(el,size){
  el.dataset.cols=size.w;el.dataset.rows=size.h;
  el.style.gridColumn=size.w==="full"?"1 / -1":`span ${size.w}`;
  el.style.minHeight=size.h>1
    ?`${ROW_UNIT*size.h+14*(size.h-1)}px`:"";
}
function widgetSize(el){
  const w=el.dataset.cols==="full"?"full":(+el.dataset.cols||1);
  return {w,h:+el.dataset.rows||1};
}
function startResize(el,ev){
  ev.preventDefault();ev.stopPropagation();
  const m=gridMetrics(),start=widgetSize(el);
  const startW=start.w==="full"?m.cols:start.w;
  const x0=ev.clientX,y0=ev.clientY;
  el.classList.add("resizing");el.draggable=false;
  const move=e=>{
    const dCols=Math.round((e.clientX-x0)/(m.trackW+m.gap));
    const dRows=Math.round((e.clientY-y0)/(ROW_UNIT+m.gap));
    let w=Math.max(1,Math.min(m.cols,startW+dCols));
    const h=Math.max(1,Math.min(MAX_SPAN,start.h+dRows));
    applyWidgetSize(el,{w:w>=m.cols?"full":w,h});
  };
  const up=()=>{
    document.removeEventListener("pointermove",move);
    document.removeEventListener("pointerup",up);
    el.classList.remove("resizing");el.draggable=ovEditing;
    saveHome();
  };
  document.addEventListener("pointermove",move);
  document.addEventListener("pointerup",up);
  el.setPointerCapture&&el.setPointerCapture(ev.pointerId);
}
function ovDecorate(){
  $("#ovGrid").querySelectorAll("[data-w]").forEach(el=>{
    const id=el.dataset.w;
    if(!el.querySelector(".hwctl")){
      const ctl=document.createElement("div");ctl.className="hwctl";
      ctl.innerHTML=`<button class="sz" title="cycle width"></button>
        <button class="rm" title="remove from home">✕</button>`;
      ctl.querySelector(".sz").onclick=e=>{e.stopPropagation();
        // the button stays as a quick way to step through the common widths
        const cur=widgetSize(el),cols=gridMetrics().cols;
        const steps=[1,2,3,"full"].filter(v=>v==="full"||v<=cols);
        const i=steps.findIndex(v=>String(v)===String(cur.w));
        applyWidgetSize(el,{w:steps[(i+1)%steps.length],h:cur.h});
        ovDecorate();saveHome();};
      ctl.querySelector(".rm").onclick=e=>{e.stopPropagation();
        const st=homeState();
        st.hidden=st.hidden.filter(x=>x!==id).concat(id);
        st.order=st.order.filter(x=>x!==id);
        homeWrite(st);
        applyHome();toast(`${HOME_WIDGETS[id].title} removed`);};
      el.appendChild(ctl);
    }
    if(!el.querySelector(".hwres")){
      const res=document.createElement("div");res.className="hwres";
      res.title="drag to resize";
      res.addEventListener("pointerdown",e=>startResize(el,e));
      el.appendChild(res);
    }
    const cur=widgetSize(el);
    el.querySelector(".hwctl .sz").textContent=
      cur.w==="full"?"▭":`${cur.w}×${cur.h}`;
    el.classList.toggle("editing",ovEditing&&!el.classList.contains("hw-off"));
    el.draggable=ovEditing;
  });
}
$("#ovCustomize")&&($("#ovCustomize").onclick=()=>{
  ovEditing=!ovEditing;
  $("#ovCustomize").textContent=ovEditing?"✓ Done":"✎ Customize home";
  $("#ovReset").style.display=ovEditing?"":"none";
  $("#ovAdd").style.display=ovEditing?"":"none";
  $("#ovExport").style.display=ovEditing?"":"none";
  $("#ovImport").style.display=ovEditing?"":"none";
  $("#ovEditHint").style.display=ovEditing?"":"none";
  ovDecorate();
  if(!ovEditing){saveHome();toast("home layout saved");}
});
$("#ovReset")&&($("#ovReset").onclick=async()=>{
  if(!confirm("Reset the home screen to its default layout?\nThis clears the saved layout on this machine too."))return;
  localStorage.removeItem("perchHome");localStorage.removeItem("perchTiles");
  try{await api("/api/homelayout",{method:"POST",body:JSON.stringify({layout:null})});}
  catch(e){}
  location.reload();});
/* ---- layout export / import ---- */
$("#ovExport")&&($("#ovExport").onclick=()=>{
  copyText(JSON.stringify(homeState(),null,1));
  toast("layout JSON copied to the clipboard");});
$("#ovImport")&&($("#ovImport").onclick=()=>{
  const raw=prompt("Paste a layout JSON (from Export on another machine):");
  if(!raw)return;
  try{
    const st=JSON.parse(raw);
    if(!st||!Array.isArray(st.order))throw new Error("that isn't a layout");
    homeWrite({order:st.order,hidden:st.hidden||[],sizes:st.sizes||{}});
    applyHome();toast("layout imported");
  }catch(e){toast("import failed: "+e.message,false);}});
$("#ovGrid")&&$("#ovGrid").addEventListener("dragstart",e=>{
  if(!ovEditing)return;dragEl=e.target.closest("[data-w]");
  if(dragEl)dragEl.classList.add("dragging");});
$("#ovGrid")&&$("#ovGrid").addEventListener("dragend",()=>{
  $("#ovGrid").querySelectorAll(".dropbefore,.dropafter").forEach(c=>
    c.classList.remove("dropbefore","dropafter"));
  if(dragEl){dragEl.classList.remove("dragging");dragEl=null;saveHome();}});
$("#ovGrid")&&$("#ovGrid").addEventListener("dragover",e=>{
  if(!ovEditing||!dragEl)return;e.preventDefault();
  const grid=$("#ovGrid");
  // a grid wraps, so "the element after the pointer" is whichever widget
  // centre is nearest — then before or after it depending on which side
  const els=[...grid.querySelectorAll("[data-w]:not(.dragging):not(.hw-off)")];
  let best=null,bestD=Infinity,after=false;
  for(const c of els){
    const r=c.getBoundingClientRect();
    const cx=r.left+r.width/2,cy=r.top+r.height/2;
    const d=(e.clientX-cx)**2+(e.clientY-cy)**2;
    if(d<bestD){bestD=d;best=c;
      after=(e.clientY>cy+r.height/4)||(e.clientX>cx);}
  }
  els.forEach(c=>c.classList.remove("dropbefore","dropafter"));
  if(!best){grid.appendChild(dragEl);return;}
  best.classList.add(after?"dropafter":"dropbefore");
  if(after)best.after(dragEl);else best.before(dragEl);});

/* ---- widget gallery ---- */
function galRender(){
  const q=($("#ovGalSearch").value||"").trim().toLowerCase();
  const st=homeState();
  const avail=Object.keys(HOME_WIDGETS).filter(id=>!st.order.includes(id)
    ||st.hidden.includes(id));
  const shown=avail.filter(id=>!q||
    (HOME_WIDGETS[id].title+" "+HOME_WIDGETS[id].desc).toLowerCase().includes(q));
  $("#ovGalCount").textContent=`${avail.length} available`;
  $("#ovGalList").innerHTML=shown.map(id=>{
    const w=HOME_WIDGETS[id];
    return `<div class="galItem" data-add="${id}"><span class="gi">${w.icon}</span>
      <div><div class="gt">${esc(w.title)}</div>
      <div class="gd">${esc(w.desc)}</div></div>
      <span class="ga">＋ Add</span></div>`;}).join("")
    ||`<div class="galItem muted">${avail.length?"no widgets match"
        :"every widget is already on your home screen 🎉"}</div>`;
  $("#ovGalList").querySelectorAll("[data-add]").forEach(el=>el.onclick=()=>{
    const id=el.dataset.add,s=homeState();
    s.hidden=s.hidden.filter(x=>x!==id);
    s.order=s.order.filter(x=>x!==id).concat(id);
    homeWrite(s);
    applyHome();galRender();
    toast(`${HOME_WIDGETS[id].title} added to the home screen`);
  });
}
function galOpen(){$("#ovGallery").classList.add("open");
  $("#ovGalSearch").value="";galRender();
  setTimeout(()=>$("#ovGalSearch").focus(),40);}
function galClose(){$("#ovGallery").classList.remove("open");}
$("#ovAdd")&&($("#ovAdd").onclick=galOpen);
$("#ovGalClose")&&($("#ovGalClose").onclick=galClose);
$("#ovGalSearch")&&($("#ovGalSearch").oninput=galRender);
$("#ovGallery")&&($("#ovGallery").onclick=e=>{
  if(e.target.id==="ovGallery")galClose();});
document.addEventListener("keydown",e=>{
  if(e.key==="Escape"&&$("#ovGallery").classList.contains("open"))galClose();});

/* ---- runtimes ---- */
async function loadSsh(){
  try{
    const s=await api("/api/sshkeys");
    $("#sshList").innerHTML=(s.keys.length?s.keys.map(k=>`
      <div style="padding:6px 0;border-bottom:1px solid var(--grid)">
        <b class="mono" style="font-size:12px">${esc(k.name)}</b>
        <span class="muted" style="font-size:11px">${esc(k.fingerprint)}</span>
        <button class="btn small" data-cp="${esc(k.public)}">copy public key</button>
        <div class="mono" style="font-size:10.5px;word-break:break-all;color:var(--muted);margin-top:2px">${esc(k.public)}</div>
      </div>`).join(""):'<span class="muted">no keys yet</span>')
      +(s.authorized_keys?`<div style="margin-top:8px"><b>authorized_keys</b>
        <pre class="mono" style="font-size:10.5px;white-space:pre-wrap;background:var(--track);padding:8px;border-radius:6px;max-height:140px;overflow:auto">${esc(s.authorized_keys)}</pre></div>`:"");
    document.querySelectorAll("[data-cp]").forEach(b=>b.onclick=()=>{
      navigator.clipboard.writeText(b.dataset.cp);toast("public key copied");});
  }catch(e){}
}
$("#sshGen")&&($("#sshGen").onclick=async()=>{
  try{await api("/api/sshkeygen",{method:"POST",body:JSON.stringify(
    {name:$("#sshName").value.trim()||"id_ed25519",comment:$("#sshComment").value.trim()})});
    $("#sshStat").textContent="key created ✓";$("#sshName").value="";loadSsh();}
  catch(e){$("#sshStat").textContent="";toast(e.message,false);}
});
async function loadRuntimes(){
  loadSsh();
  try{
    const r=await api("/api/runtimes");
    $("#rtTable tbody").innerHTML=r.tools.map(t=>`
      <tr><td style="width:90px"><b>${esc(t.name)}</b></td>
      <td class="mono" style="font-size:12px">${esc(t.version)}</td>
      <td class="mono muted" style="font-size:11px">${esc(t.path)}</td></tr>`).join("");
    $("#rtRust").innerHTML=r.rust_toolchains.length?
      r.rust_toolchains.map(tc=>`<button class="btn small" data-rust="${esc(tc)}"
        style="${tc===r.rust_active?"border-color:var(--s1);font-weight:700":""}">${esc(tc)}${tc===r.rust_active?" ✓":""}</button>`).join(" ")
      :'<span class="muted">rustup not installed</span>';
    document.querySelectorAll("[data-rust]").forEach(b=>b.onclick=()=>runJob(
      api("/api/setruntime",{method:"POST",body:JSON.stringify({kind:"rust",value:b.dataset.rust})})));
    $("#rtNode").innerHTML=r.has_nvm
      ?(r.node_versions.length?"nvm versions: "+r.node_versions.map(v=>`<span class="pill">${esc(v)}</span>`).join(" ")
        +'<div class="muted" style="font-size:12px;margin-top:6px">switch with <code>nvm use &lt;version&gt;</code> in a terminal (per-shell)</div>'
        :'<span class="muted">nvm present, no versions installed</span>')
      :'<span class="muted">single system Node.js — install <b>nvm</b> to manage multiple versions</span>';
    const alts=r.alternatives||[];
    $("#rtAlts").innerHTML=alts.length?`<table><tbody>`+alts.map((a,i)=>`
      <tr><td style="width:180px"><b>${esc(a.name)}</b>${a.auto?' <span class="muted" style="font-size:11px">(auto)</span>':""}</td>
      <td><select class="btn altsel" data-name="${esc(a.name)}" data-i="${i}">`+
      a.options.map(o=>`<option value="${esc(o)}" ${o===a.current?"selected":""}>${esc(o)}</option>`).join("")+
      `</select></td>
      <td class="num"><button class="btn small" data-alt="${i}">Switch</button></td></tr>`).join("")+
      `</tbody></table>`:'<span class="muted">no multi-candidate alternatives</span>';
    document.querySelectorAll("[data-alt]").forEach(b=>b.onclick=()=>{
      const sel=document.querySelector(`.altsel[data-i="${b.dataset.alt}"]`);
      if(sel.value===alts[+b.dataset.alt].current){toast("already the active version");return;}
      runJob(api("/api/setalternative",{method:"POST",
        body:JSON.stringify({name:sel.dataset.name,path:sel.value})}));
    });
  }catch(e){toast(e.message,false);}
}

/* ---- LLM provider config ---- */
const LLM_HINTS={"claude-cli":"uses your logged-in Claude Code CLI (no key)",
  "anthropic":"api.anthropic.com — needs an API key",
  "openai":"OpenAI or any compatible gateway — key + base URL",
  "ollama":"local models, no key — great for private/offline summaries"};
const LLM_MODELS={"claude-cli":"",anthropic:"claude-sonnet-5",
  openai:"gpt-4o-mini",ollama:"llama3.2"};
function llmSyncFields(){
  const p=$("#llmProvider").value;
  $("#llmHint").textContent=LLM_HINTS[p]||"";
  document.querySelectorAll(".llm-field").forEach(el=>el.style.display=p==="claude-cli"?"none":"flex");
  $("#llmKeyRow").style.display=(p==="anthropic"||p==="openai")?"flex":"none";
  $("#llmUrlRow").style.display=(p==="openai"||p==="ollama"||p==="anthropic")?"flex":"none";
}
async function loadLLM(){
  try{
    const c=await api("/api/llm");
    const sel=$("#llmProvider");
    // hide CLI option if the CLI isn't installed
    if(!c.cli_available)sel.querySelector('option[value="claude-cli"]').disabled=true;
    sel.value=c.provider;
    $("#llmModel").value=c.model||LLM_MODELS[c.provider]||"";
    $("#llmModel").placeholder=LLM_MODELS[c.provider]||"model id";
    $("#llmUrl").value=c.base_url||"";
    $("#llmKeyState").textContent=c.has_key?"✓ key saved":"no key set";
    $("#llmKey").value="";
    llmSyncFields();
    aiSetProvider(c);
  }catch(e){}
}
$("#llmProvider")&&($("#llmProvider").onchange=()=>{
  llmSyncFields();
  if(!$("#llmModel").value)$("#llmModel").value=LLM_MODELS[$("#llmProvider").value]||"";
  $("#llmModel").placeholder=LLM_MODELS[$("#llmProvider").value]||"model id";});
$("#llmSave")&&($("#llmSave").onclick=async()=>{
  const body={provider:$("#llmProvider").value,model:$("#llmModel").value.trim(),
    base_url:$("#llmUrl").value.trim()};
  if($("#llmKey").value.trim())body.api_key=$("#llmKey").value.trim();
  try{await api("/api/llmconfig",{method:"POST",body:JSON.stringify(body)});
    $("#llmStatus").textContent="saved ✓";toast("AI provider saved");loadLLM();}
  catch(e){toast(e.message,false);}});
$("#llmTest")&&($("#llmTest").onclick=async()=>{
  $("#llmStatus").textContent="testing…";
  try{const r=await api("/api/llmtest",{method:"POST",body:"{}"});
    $("#llmStatus").textContent="✓ "+(r.reply||"ok");}
  catch(e){$("#llmStatus").textContent="";toast(e.message,false);}});

/* ---- site preview ---- */
$("#siteGo")&&($("#siteGo").onclick=async()=>{
  const url=$("#siteUrl").value.trim();if(!url)return;
  $("#siteStat").textContent="rendering…";
  try{
    const r=await api("/api/sitepreview",{method:"POST",body:JSON.stringify({url})});
    $("#siteStat").textContent="";
    $("#lbName").textContent=r.url;
    $("#lbBody").innerHTML=`<img src="/api/shot?path=${encodeURIComponent(r.path)}&t=${TOKEN}"
      style="max-width:100%;max-height:82vh;border-radius:8px;background:#fff">`;
    $("#lightbox").style.display="flex";
  }catch(e){$("#siteStat").textContent="";toast(e.message,false);}
});
$("#siteUrl")&&($("#siteUrl").onkeydown=e=>{if(e.key==="Enter")$("#siteGo").click();});

/* ---- open-with popup menu ---- */
let owApps=null;
async function ensureApps(){if(!owApps){owApps=(await api("/api/apps")).apps;}return owApps;}
async function openWithMenu(ev,path,kind){
  ev.stopPropagation();
  const apps=(await ensureApps()).filter(a=>a.kind==="both"||a.kind===kind);
  document.querySelectorAll(".owmenu").forEach(m=>m.remove());
  const menu=document.createElement("div");
  menu.className="owmenu";
  menu.style.cssText=`position:fixed;z-index:12;background:var(--surface);
    border:1px solid var(--border);border-radius:10px;padding:5px;
    box-shadow:0 10px 30px rgba(0,0,0,.28);min-width:170px`;
  const isImg=preview_kindJS(path)==="image";
  menu.innerHTML=apps.map(a=>`<div class="palItem" data-app="${a.key}">${esc(a.label)}</div>`).join("")+
    (kind==="dir"?`<div class="palItem" data-term-here="1">🖥 Terminal here</div>`:"")+
    (isImg?`<div class="palItem" data-wallpaper="1">🖼 Set as wallpaper</div>`:"")+
    `<div class="palItem" data-preview-file="1">👁 Preview in dashboard</div>`;
  document.body.appendChild(menu);
  const r=ev.target.getBoundingClientRect();
  menu.style.left=Math.min(r.left,innerWidth-menu.offsetWidth-8)+"px";
  menu.style.top=(r.bottom+4)+"px";
  menu.querySelectorAll("[data-app]").forEach(el=>el.onclick=async()=>{
    menu.remove();
    try{const res=await api("/api/openwith",{method:"POST",
      body:JSON.stringify({app:el.dataset.app,path})});toast("opened in "+res.app);}
    catch(e){toast(e.message,false);}});
  const th=menu.querySelector("[data-term-here]");
  if(th)th.onclick=()=>{menu.remove();
    openInTerminal({cwd:path,name:(path.split("/").pop()||"shell")});};
  const wp=menu.querySelector("[data-wallpaper]");
  if(wp)wp.onclick=async()=>{menu.remove();
    try{await api("/api/setsetting",{method:"POST",
      body:JSON.stringify({key:"wallpaper",value:path})});toast("wallpaper set 🖼");}
    catch(e){toast(e.message,false);}};
  const pf=menu.querySelector("[data-preview-file]");
  if(pf)pf.onclick=()=>{menu.remove();
    const pk=/\.(docx|xlsx|xlsm)$/i.test(path)?"office":preview_kindJS(path);
    if(pk)showPreview(path,pk);else toast("no in-dashboard preview for this type",false);};
  setTimeout(()=>document.addEventListener("click",function h(){menu.remove();
    document.removeEventListener("click",h);}),0);
}
function preview_kindJS(name){
  const ext=(name.split(".").pop()||"").toLowerCase();
  if(["png","jpg","jpeg","gif","webp","svg","ico","bmp"].includes(ext))return"image";
  if(ext==="pdf")return"pdf";
  if(["mp4","webm","mkv"].includes(ext))return"video";
  if(["mp3","wav","ogg","m4a","flac"].includes(ext))return"audio";
  return null;
}

/* ---- drawer save-to quick targets ---- */
document.querySelectorAll("[data-dest]").forEach(b=>b.onclick=()=>{
  const d=b.dataset.dest;
  $("#dFolder").value=d==="home"?HOME_DIR:HOME_DIR+"/"+d;
});

applyHome();
homeLoadRemote();
initAccentUI();
if(bgMode!=="none")startBg(bgMode);
/* ---- overview: critical logs needing attention ---- */
async function loadCritLogs(){
  try{
    const r=await api("/api/logs?source=system&prio=3&n=60");
    const rows=(r.entries||[]).slice(-8).reverse();
    $("#critLogs").innerHTML=rows.length?rows.map(e=>{
      const t=new Date(e.t*1000).toLocaleString([],{month:"short",day:"numeric",
        hour:"2-digit",minute:"2-digit"});
      return `<div style="padding:3px 0;border-bottom:1px solid var(--grid)">
        <span class="muted">${t}</span>
        <b class="mono" style="color:var(--s1);font-size:11px">${esc(e.unit.replace(/\.service$/,""))}</b>
        <span style="color:var(--crit)">${esc(e.msg)}</span></div>`;
    }).join(""):'<span style="color:var(--goodtext)">no recent errors 🎉</span>';
  }catch(e){$("#critLogs").innerHTML='<span class="muted">log read unavailable</span>';}
}
$("#critMore")&&($("#critMore").onclick=()=>goTab("logs"));
/* ---- overview: health scorecard with one-click fixes ---- */
async function loadHealth(){
  try{
    const h=await api("/api/healthscore");
    const color=h.score>=90?"var(--goodtext)":h.score>=75?"var(--s1)":
      h.score>=50?"var(--s7,#e6a400)":"var(--crit)";
    $("#hsVerdict").innerHTML=`— <b style="color:${color}">${h.score}/100 · ${esc(h.verdict)}</b>`;
    const icon={crit:"🔴",warn:"🟠",info:"🔵"};
    const act={upgrade:["Install updates","upgrade"],
      clean:["Free up space","clean"],updates:["See updates","updates"],
      logs:["Open logs","logs"],dev:["See services","dev"]};
    $("#hsBody").innerHTML=h.findings.length?h.findings.map((f,i)=>{
      const a=f.action&&act[f.action];
      return `<div style="display:flex;gap:8px;align-items:center;padding:5px 0;border-bottom:1px solid var(--grid)">
        <span>${icon[f.sev]||"ℹ️"}</span>
        <div style="flex:1"><b>${esc(f.title)}</b>
          <span class="muted">${esc(f.detail)}</span></div>
        ${a?`<button class="btn small" data-hs="${f.action}">${a[0]}</button>`:""}</div>`;
    }).join(""):'<span style="color:var(--goodtext)">everything looks healthy 🎉</span>';
    document.querySelectorAll("[data-hs]").forEach(b=>b.onclick=()=>{
      const k=b.dataset.hs;
      if(k==="upgrade"){
        if(!confirm("Install all pending updates now?\nA password dialog may appear."))return;
        runJob(api("/api/upgradeall",{method:"POST",body:JSON.stringify({mgr:"native"})}));
      }else goTab(k);
    });
  }catch(e){$("#hsBody").textContent="health check unavailable";}
}
$("#hsRefresh")&&($("#hsRefresh").onclick=loadHealth);
loadOverview();setInterval(loadOverview,2500);
loadHW();setInterval(loadHW,60000);
loadCritLogs();setInterval(loadCritLogs,60000);
loadHealth();setInterval(loadHealth,300000);

/* ---- storage ---- */
let showSmall=false;
/* ---- backup helper ---- */
async function loadBackup(){
  try{
    const b=await api("/api/backup");
    $("#bkSources").value=(b.sources||[]).join("\n");
    $("#bkDest").value=b.dest||"";
    $("#bkSched").value=b.schedule||"off";
    const last=b.last&&b.last.t?`Last backup: ${new Date(b.last.t*1000).toLocaleString()} ✓`
      :"No backup has run yet.";
    const nxt=b.timer&&b.timer.enabled?` · next scheduled: ${esc(b.timer.next)}`:"";
    $("#bkLast").innerHTML=(b.rsync?"":"⚠ rsync is not installed — install it from the Packages tab. ")
      +esc(last)+nxt;
  }catch(e){}
}
function bkPayload(){
  return {sources:$("#bkSources").value.split("\n").map(s=>s.trim()).filter(Boolean),
    dest:$("#bkDest").value.trim(),schedule:$("#bkSched").value};
}
$("#bkSave")&&($("#bkSave").onclick=async()=>{
  try{await api("/api/backup",{method:"POST",body:JSON.stringify(bkPayload())});
    toast("backup settings saved");loadBackup();}
  catch(e){toast(e.message,false);}
});
$("#bkRun")&&($("#bkRun").onclick=async()=>{
  try{await api("/api/backup",{method:"POST",body:JSON.stringify(bkPayload())});
    runJob(api("/api/backuprun",{method:"POST",body:"{}"}));
    setTimeout(loadBackup,3000);}
  catch(e){toast(e.message,false);}
});
async function loadStorage(){
  loadBackup();loadDiskHealth();
  const ds=await api("/api/disks");
  const big=ds.filter(d=>d.used>=500*2**20||d.mount==="/");
  const small=ds.filter(d=>!big.includes(d));
  const shown=showSmall?ds:big;
  $("#diskList").innerHTML=shown.map(d=>`
    <div style="margin:10px 0">
      <div style="display:flex;justify-content:space-between;font-size:13px">
        <span><b>${esc(d.mount)}</b> <span class="muted">${esc(d.device)} · ${esc(d.fstype)}</span></span>
        <span class="num">${fmtB(d.used)} used · ${fmtB(d.free)} free · ${d.percent.toFixed(0)}%${usageNote(d.percent)}</span>
      </div>
      <div class="bar" style="margin-top:5px"><i style="width:${d.percent}%;background:${usageColor(d.percent)}"></i></div>
    </div>`).join("")+
    (small.length?`<div style="margin-top:10px"><button class="btn small" id="moreMounts">
      ${showSmall?"Hide":"Show"} ${small.length} small mounts (&lt; 500 MB used)</button></div>`:"");
  const mb=$("#moreMounts");
  if(mb)mb.onclick=()=>{showSmall=!showSmall;loadStorage();};
  renderCrumbs($("#duCrumbs"),duPath,duNav);
}
let duPath=HOME_DIR;
function duNav(p){duPath=p;renderCrumbs($("#duCrumbs"),duPath,duNav);}
function renderCrumbs(el,path,onNav){
  const parts=path.split("/").filter(Boolean);
  let acc="";
  let html=`<a data-p="/">/</a>`;
  for(const p of parts){acc+="/"+p;
    html+=`<span class="sep">/</span><a data-p="${esc(acc)}">${esc(p)}</a>`;}
  el.innerHTML=html;
  el.querySelectorAll("a").forEach(a=>a.onclick=()=>onNav(a.dataset.p));
}
$("#duGo").onclick=async()=>{
  $("#duNote").textContent="scanning… (up to 15 s)";$("#duList").innerHTML="";
  try{
    const r=await api("/api/du?path="+encodeURIComponent(duPath));
    $("#duNote").textContent=r.timedout?"partial — scan hit the 15 s budget":"";
    const max=Math.max(1,...r.items.map(i=>i.size));
    $("#duList").innerHTML=`<table><tbody>`+r.items.map(i=>`
      <tr><td style="width:34%"><span class="name" data-p="${esc(r.path+"/"+i.name)}" data-dir="${i.dir}">${i.dir?"📁":"📄"} ${esc(i.name)}</span>${i.complete?"":" <span class='muted'>(≥)</span>"}</td>
      <td class="num" style="width:110px">${fmtB(i.size)}</td>
      <td><div class="bar"><i style="width:${(i.size/max*100).toFixed(1)}%"></i></div></td></tr>`).join("")+`</tbody></table>`;
    $("#duList").querySelectorAll(".name").forEach(n=>n.onclick=()=>{
      if(n.dataset.dir==="true"){duNav(n.dataset.p);$("#duGo").click();}
    });
  }catch(e){$("#duNote").textContent="";toast(e.message,false);}
};

/* ---- processes ---- */
let psort="cpu";
$("#sortCpu").onclick=()=>{psort="cpu";loadProcs()};
$("#sortMem").onclick=()=>{psort="mem";loadProcs()};
