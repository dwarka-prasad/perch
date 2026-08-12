/* Perch — processes, users, files, terminal, database, search, network, containers.
   Part of the frontend, split positionally from one file: the
   scripts are loaded in order and share one global scope, so
   execution order is exactly as it was. */
$("#pq").oninput=()=>{clearTimeout(window._pq);window._pq=setTimeout(loadProcs,300)};
async function loadProcs(){
  if(!$("#tab-proc").classList.contains("on"))return;
  const ps=await api(`/api/processes?sort=${psort}&q=${encodeURIComponent($("#pq").value)}`);
  $("#sortCpu").style.fontWeight=psort==="cpu"?"700":"400";
  $("#sortMem").style.fontWeight=psort==="mem"?"700":"400";
  $("#ptable tbody").innerHTML=ps.map(p=>`
    <tr title="${esc(p.cmd)}">
      <td class="mono">${p.pid}</td>
      <td><span class="name" data-pinfo="${p.pid}"><b>${esc(p.name)}</b></span></td>
      <td class="muted">${esc(p.user)}</td>
      <td class="num">${p.cpu.toFixed(1)}</td>
      <td class="num">${fmtB(p.mem)}</td>
      <td class="muted">${esc(p.status)}</td>
      <td class="num">${p.mine?`<button class="btn small danger" data-pid="${p.pid}" data-name="${esc(p.name)}">End</button>`:""}</td>
    </tr>`).join("");
  $("#ptable").querySelectorAll("[data-pinfo]").forEach(n=>n.onclick=()=>procModal(+n.dataset.pinfo));
  $("#ptable").querySelectorAll("button[data-pid]").forEach(b=>b.onclick=async()=>{
    if(!confirm(`End process ${b.dataset.name} (PID ${b.dataset.pid})?`))return;
    try{const r=await api("/api/kill",{method:"POST",
      body:JSON.stringify({pid:+b.dataset.pid})});
      toast(`sent terminate to ${r.name}`);setTimeout(loadProcs,600);}
    catch(e){
      if(confirm(e.message+"\n\nForce kill (SIGKILL)?")){
        try{await api("/api/kill",{method:"POST",
          body:JSON.stringify({pid:+b.dataset.pid,force:true})});
          toast("force-killed");setTimeout(loadProcs,600);}
        catch(e2){toast(e2.message,false);}
      }
    }
  });
}
setInterval(loadProcs,3000);

/* ---- users ---- */
async function loadUsers(){
  const u=await api("/api/users");
  $("#sess tbody").innerHTML=u.sessions.map(s=>`
    <tr><td><b>${esc(s.name)}</b></td><td class="mono">${esc(s.terminal)}</td>
    <td>${esc(s.host)}</td><td>${ago(s.started)}</td></tr>`).join("")
    ||`<tr><td colspan=4 class="muted">no active sessions reported</td></tr>`;
  const maxm=Math.max(1,...u.usage.map(x=>x.mem));
  $("#uusage tbody").innerHTML=u.usage.map(x=>`
    <tr><td><b>${esc(x.user)}</b></td><td class="num">${x.procs}</td>
    <td class="num">${x.cpu.toFixed(1)}</td><td class="num">${fmtB(x.mem)}</td>
    <td><div class="bar"><i style="width:${(x.mem/maxm*100).toFixed(1)}%"></i></div></td></tr>`).join("");
  $("#uacct tbody").innerHTML=u.accounts.map(a=>`
    <tr><td><b>${esc(a.user)}</b></td><td class="num">${a.uid}</td>
    <td class="mono">${esc(a.home)}</td><td class="mono">${esc(a.shell)}</td></tr>`).join("");
}

/* ---- files ---- */
let fPath=HOME_DIR;
$("#showHidden").onchange=()=>loadFiles(fPath);
async function loadFiles(path){
  try{
    const r=await api("/api/browse?path="+encodeURIComponent(path));
    fPath=r.path;
    renderCrumbs($("#fCrumbs"),fPath,p=>loadFiles(p));
    const hidden=$("#showHidden").checked;
    const rows=r.entries.filter(e=>hidden||!e.hidden).map(e=>{
      const full=(fPath==="/"?"":fPath)+"/"+e.name;
      return `<tr>
        <td><input type="checkbox" class="fsel" data-p="${esc(full)}"></td>
        <td><span class="name" data-p="${esc(full)}" data-dir="${e.dir}">
          ${e.dir?"📁":"📄"} ${esc(e.name)}${e.link?" <span class='muted'>→</span>":""}</span></td>
        <td class="num">${e.dir?"—":fmtB(e.size)}</td>
        <td class="num muted">${ago(e.mtime)}</td>
        <td class="num" style="white-space:nowrap">${e.dir
          ?`<button class="btn small cap-term" data-term="${esc(full)}">Terminal</button>
            <button class="btn small" data-openwith="${esc(full)}" data-kind="dir">Open with ▾</button>`
          :`${e.pv||/\.(docx|xlsx|xlsm)$/i.test(e.name)?`<button class="btn small" data-pv="${e.pv||"office"}" data-pvp="${esc(full)}">Preview</button>`:""}
            <button class="btn small" data-view="${esc(full)}">Edit</button>
            <button class="btn small" data-openwith="${esc(full)}" data-kind="file">Open with ▾</button>
            <button class="btn small danger" data-trash="${esc(full)}">Trash</button>`}</td></tr>`;
    }).join("");
    $("#ftable tbody").innerHTML=rows||`<tr><td colspan=5 class="muted">empty folder</td></tr>`;
    $("#selAll").checked=false;updBulk();
    $("#ftable").querySelectorAll(".fsel").forEach(c=>c.onchange=updBulk);
    if(r.truncated)toast("showing first 800 entries",false);
    $("#ftable").querySelectorAll(".name").forEach(n=>n.onclick=()=>{
      if(n.dataset.dir==="true")loadFiles(n.dataset.p);
      else openPath(n.dataset.p);
    });
    $("#ftable").querySelectorAll("[data-open]").forEach(b=>b.onclick=()=>openPath(b.dataset.open));
    $("#ftable").querySelectorAll("[data-view]").forEach(b=>b.onclick=()=>editInDrawer(b.dataset.view));
    $("#ftable").querySelectorAll("[data-edit]").forEach(b=>b.onclick=async()=>{
      try{const r=await api("/api/editor",{method:"POST",
        body:JSON.stringify({path:b.dataset.edit})});toast("opened in "+r.editor);}
      catch(e){toast(e.message,false);}});
    $("#ftable").querySelectorAll("[data-term]").forEach(b=>b.onclick=()=>
      openInTerminal({cwd:b.dataset.term,
        name:(b.dataset.term.split("/").pop()||"shell")}));
    $("#ftable").querySelectorAll("[data-pv]").forEach(b=>b.onclick=()=>
      showPreview(b.dataset.pvp,b.dataset.pv));
    $("#ftable").querySelectorAll("[data-openwith]").forEach(b=>b.onclick=e=>
      openWithMenu(e,b.dataset.openwith,b.dataset.kind));
    applyCaps();
    $("#ftable").querySelectorAll("[data-trash]").forEach(b=>b.onclick=async()=>{
      if(!confirm(`Move to trash?\n${b.dataset.trash}`))return;
      try{await api("/api/trash",{method:"POST",body:JSON.stringify({path:b.dataset.trash})});
        toast("moved to trash");loadFiles(fPath);}
      catch(e){toast(e.message,false);}
    });
  }catch(e){toast(e.message,false);}
}
function selPaths(){return[...document.querySelectorAll("#ftable .fsel:checked")]
  .map(c=>c.dataset.p);}
function updBulk(){
  const n=selPaths().length;
  $("#bulkBar").style.display=n?"flex":"none";
  $("#bulkN").textContent=n+" selected";
}
$("#selAll").onchange=()=>{
  document.querySelectorAll("#ftable .fsel").forEach(c=>c.checked=$("#selAll").checked);
  updBulk();
};
$("#bulkClear").onclick=()=>{
  document.querySelectorAll("#ftable .fsel").forEach(c=>c.checked=false);
  $("#selAll").checked=false;updBulk();
};
$("#bulkTrash").onclick=async()=>{
  const paths=selPaths();
  if(!paths.length)return;
  if(!confirm(`Move ${paths.length} item${paths.length>1?"s":""} to trash?\n\n`+
    paths.slice(0,8).map(p=>"• "+p.split("/").pop()).join("\n")+
    (paths.length>8?`\n…and ${paths.length-8} more`:"")))return;
  try{
    const r=await api("/api/trash",{method:"POST",body:JSON.stringify({paths})});
    toast(`trashed ${r.trashed} item${r.trashed===1?"":"s"}`+
      (r.errors.length?` · ${r.errors.length} failed: ${r.errors[0]}`:""),!r.errors.length);
    loadFiles(fPath);
  }catch(e){toast(e.message,false);}
};
$("#termHere").onclick=()=>
  openInTerminal({cwd:fPath,name:(fPath.split("/").pop()||"shell")});
$("#codeHere").onclick=async()=>{
  try{const r=await api("/api/editor",{method:"POST",body:JSON.stringify({path:fPath})});
    toast("opened in "+r.editor);}catch(e){toast(e.message,false);}};
/* ---- capabilities: hide buttons for apps this machine doesn't have ---- */
/* ---- web terminal — kitty-style tabs + splits + fullscreen ------------------
   Each pane is an independent xterm + websocket + pty. A tab holds a binary
   split-tree of panes (leaf {pane} | split {dir,ratio,a,b}); the stage renders
   that tree into flex containers with draggable gutters. */
let TERMTABS=[],TERM_ACTIVE=null,TERM_FONT=13,_termInit=false,_paneSeq=0;

function _paneFit(p){try{p.fit.fit();
  if(p.ws&&p.ws.readyState===1)
    p.ws.send("r"+JSON.stringify({cols:p.term.cols,rows:p.term.rows}));
}catch(e){}}
function _fitAll(){const t=curTab();if(t)_leaves(t.layout).forEach(_paneFit);}

function makePane(opts){
  const id=++_paneSeq;
  const el=document.createElement("div");el.className="term-pane";
  const host=document.createElement("div");host.className="xt";el.appendChild(host);
  const term=new Terminal({fontSize:TERM_FONT,
    fontFamily:"ui-monospace,Menlo,'Cascadia Code',monospace",
    cursorBlink:true,scrollback:5000,theme:{background:"#000000"}});
  const fit=new FitAddon.FitAddon();term.loadAddon(fit);term.open(host);
  const p={id,el,host,term,fit,ws:null,ro:null,name:"shell",opts:opts||null};
  term.onData(d=>p.ws&&p.ws.readyState===1&&p.ws.send("i"+d));
  term.onTitleChange(t=>{p.name=t||"shell";renderTabs();});
  term.attachCustomKeyEventHandler(e=>{
    if(e.type!=="keydown"||!e.ctrlKey||!e.shiftKey)return true;
    const k=e.key.toLowerCase();const act={t:()=>newTab(),e:()=>splitActive("row"),
      o:()=>splitActive("col"),w:()=>closePane(),
      "+":()=>fontZoom(1),"=":()=>fontZoom(1),"_":()=>fontZoom(-1),
      "-":()=>fontZoom(-1)}[k];
    if(act){e.preventDefault();act();return false;}
    return true;
  });
  el.addEventListener("mousedown",()=>setActivePane(p));
  p.ro=new ResizeObserver(()=>_paneFit(p));p.ro.observe(el);
  connectPane(p);
  return p;
}
function connectPane(p){
  const proto=location.protocol==="https:"?"wss:":"ws:";
  let url=`${proto}//${location.host}/ws/term`;
  const q=[];
  if(p.opts&&p.opts.cwd)q.push("cwd="+encodeURIComponent(p.opts.cwd));
  if(p.opts&&p.opts.cmd)q.push("cmd="+encodeURIComponent(btoa(p.opts.cmd)));
  if(q.length)url+="?"+q.join("&");
  p.ws=new WebSocket(url);
  p.ws.binaryType="arraybuffer";
  p.ws.onopen=()=>{_paneFit(p);};
  p.ws.onmessage=e=>p.term.write(typeof e.data==="string"?e.data:
    new Uint8Array(e.data));
  p.ws.onclose=()=>p.term.write(
    "\r\n\x1b[90m[session ended]\x1b[0m\r\n");
}
function disposePane(p){try{p.ro.disconnect();}catch(e){}
  try{p.ws.close();}catch(e){}try{p.term.dispose();}catch(e){}}

/* --- split tree helpers --- */
function _leaves(n,out){out=out||[];if(n.leaf)out.push(n.pane);
  else{_leaves(n.a,out);_leaves(n.b,out);}return out;}
function _replaceLeaf(n,pane,repl){
  if(n.leaf)return n.pane===pane?repl:n;
  n.a=_replaceLeaf(n.a,pane,repl);n.b=_replaceLeaf(n.b,pane,repl);return n;}
function _removeLeaf(n,pane){
  if(n.leaf)return n.pane===pane?null:n;
  const a=_removeLeaf(n.a,pane),b=_removeLeaf(n.b,pane);
  if(!a)return b;if(!b)return a;n.a=a;n.b=b;return n;}
function curTab(){return TERMTABS.find(t=>t.id===TERM_ACTIVE);}

function _buildNode(node){
  if(node.leaf){node.pane.el.style.flex="1 1 0";return node.pane.el;}
  const box=document.createElement("div");
  box.className="term-layout"+(node.dir==="col"?" col":"");
  const a=_buildNode(node.a),b=_buildNode(node.b);
  a.style.flex="0 0 "+((node.ratio||.5)*100)+"%";b.style.flex="1 1 0";
  const g=document.createElement("div");
  g.className="term-gutter "+node.dir;
  _gutterDrag(g,box,node,a);
  box.append(a,g,b);return box;
}
function _gutterDrag(g,box,node,aEl){
  g.addEventListener("pointerdown",e=>{
    e.preventDefault();g.setPointerCapture(e.pointerId);
    const move=ev=>{
      const r=box.getBoundingClientRect();
      let frac=node.dir==="row"?(ev.clientX-r.left)/r.width
        :(ev.clientY-r.top)/r.height;
      frac=Math.max(.1,Math.min(.9,frac));node.ratio=frac;
      aEl.style.flex="0 0 "+(frac*100)+"%";requestAnimationFrame(_fitAll);
    };
    const up=()=>{g.removeEventListener("pointermove",move);
      g.removeEventListener("pointerup",up);_fitAll();};
    g.addEventListener("pointermove",move);g.addEventListener("pointerup",up);
  });
}
function renderStage(){
  const t=curTab();const stage=$("#termStage");stage.innerHTML="";
  if(!t)return;
  _leaves(t.layout).forEach(p=>p.el.remove());
  stage.appendChild(_buildNode(t.layout));
  setTimeout(()=>{_fitAll();if(t.active)setActivePane(t.active);},20);
}
function renderTabs(){
  const box=$("#termTabs");if(!box)return;box.innerHTML="";
  TERMTABS.forEach((t,i)=>{
    const el=document.createElement("div");
    el.className="term-tab"+(t.id===TERM_ACTIVE?" on":"");
    el.innerHTML=`<span class="tname">${esc(t.title||("Session "+(i+1)))}</span>`+
      `<span class="tx">✕</span>`;
    el.querySelector(".tname").onclick=()=>activateTab(t.id);
    el.querySelector(".tx").onclick=e=>{e.stopPropagation();closeTab(t.id);};
    box.appendChild(el);
  });
}
function setActivePane(p){
  const t=curTab();if(!t)return;t.active=p;
  _leaves(t.layout).forEach(x=>x.el.classList.toggle("active",x===p));
  t.title=p.name;renderTabs();
  try{p.term.focus();}catch(e){}
}
function newTab(opts){
  const p=makePane(opts);
  const t={id:++_paneSeq,layout:{leaf:true,pane:p},active:p,
    title:(opts&&opts.name)||"shell"};
  TERMTABS.push(t);TERM_ACTIVE=t.id;renderTabs();renderStage();
}
function activateTab(id){TERM_ACTIVE=id;renderTabs();renderStage();}
function closeTab(id){
  const t=TERMTABS.find(x=>x.id===id);if(!t)return;
  _leaves(t.layout).forEach(disposePane);
  const i=TERMTABS.indexOf(t);TERMTABS.splice(i,1);
  if(TERM_ACTIVE===id)TERM_ACTIVE=(TERMTABS[i]||TERMTABS[i-1]||{}).id||null;
  if(!TERMTABS.length)newTab();else{renderTabs();renderStage();}
}
function splitActive(dir){
  const t=curTab();if(!t||!t.active)return;
  const np=makePane();
  const repl={leaf:false,dir,ratio:.5,
    a:{leaf:true,pane:t.active},b:{leaf:true,pane:np}};
  t.layout=_replaceLeaf(t.layout,t.active,repl);
  renderStage();setActivePane(np);
}
function closePane(){
  const t=curTab();if(!t||!t.active)return;
  const dead=t.active;t.layout=_removeLeaf(t.layout,dead);
  disposePane(dead);
  if(!t.layout){closeTab(t.id);return;}
  t.active=_leaves(t.layout)[0];renderStage();setActivePane(t.active);
}
function fontZoom(d){
  const t=curTab();if(!t||!t.active)return;
  TERM_FONT=Math.max(8,Math.min(28,(t.active.term.options.fontSize||13)+d));
  t.active.term.options.fontSize=TERM_FONT;_paneFit(t.active);
}
function toggleFull(){
  // Pure CSS maximize — fills the browser window. We deliberately do NOT call
  // the native Fullscreen API: in the WebKitGTK desktop window it can crash
  // the embedder, and it adds nothing over filling the window here. The button
  // toggles it (no Esc binding, so a fullscreen vim's Esc is untouched).
  const card=$("#termCard");
  const on=card.classList.toggle("fs");
  const btn=$("#termFull");if(btn)btn.textContent=on?"⛶ Exit":"⛶ Fullscreen";
  setTimeout(_fitAll,80);
}
let _pendingTermOpts=null;
function openTerminal(){
  if(!_termInit){
    _termInit=true;
    $("#termNewTab").onclick=()=>newTab();
    $("#termSplitR").onclick=()=>splitActive("row");
    $("#termSplitD").onclick=()=>splitActive("col");
    $("#termFontUp").onclick=()=>fontZoom(1);
    $("#termFontDn").onclick=()=>fontZoom(-1);
    $("#termClose").onclick=()=>closePane();
    $("#termFull").onclick=()=>toggleFull();
    newTab(_pendingTermOpts||undefined);_pendingTermOpts=null;
  }else if(_pendingTermOpts){
    newTab(_pendingTermOpts);_pendingTermOpts=null;
  }else{renderStage();}
}
// Open Perch's own terminal (a new tab) in a folder or running a command,
// instead of launching an external terminal emulator.
function openInTerminal(opts){_pendingTermOpts=opts;goTab("term");}

/* ---- scheduled tasks: crontab + systemd timers ---- */
let schedLoaded=false;
async function loadSched(){
  if(schedLoaded)return;schedLoaded=true;
  try{
    const c=await api("/api/cron");
    $("#cronEdit").value=c.raw||"";
    if(!c.installed)$("#cronStat").textContent="cron is not installed";
  }catch(e){}
  loadTimers();
  $("#cronSave").onclick=async()=>{
    try{await api("/api/cronsave",{method:"POST",
      body:JSON.stringify({text:$("#cronEdit").value})});
      $("#cronStat").textContent="saved ✓";}
    catch(e){$("#cronStat").textContent="";toast(e.message,false);}};
}
async function loadTimers(){
  try{
    const r=await api("/api/timers");
    $("#timerTable").innerHTML=r.timers.map(t=>`<tr>
      <td><b class="mono" style="font-size:12px">${esc(t.unit)}</b>
        <span class="muted" style="font-size:11px">${t.scope}</span></td>
      <td class="muted" style="font-size:12px">${esc(t.left||t.next||"—")}</td>
      <td class="num">${t.scope==="user"
        ?`<button class="btn small" data-tu="${esc(t.unit)}" data-ta="${t.enabled?"disable":"enable"}">${t.enabled?"Disable":"Enable"}</button>`
        :`<span class="muted" style="font-size:11px">${t.enabled?"enabled":"disabled"}</span>`}</td></tr>`).join("");
    document.querySelectorAll("[data-tu]").forEach(b=>b.onclick=async()=>{
      try{await api("/api/timeraction",{method:"POST",
        body:JSON.stringify({unit:b.dataset.tu,action:b.dataset.ta})});
        loadTimers();}catch(e){toast(e.message,false);}});
  }catch(e){}
}

/* ---- database browser ---- */
let dbEngine="sqlite",dbLoaded=false;
async function loadDb(){
  if(dbLoaded)return;dbLoaded=true;
  document.querySelectorAll("#dbEngine button").forEach(b=>b.onclick=()=>{
    dbEngine=b.dataset.eng;
    document.querySelectorAll("#dbEngine button").forEach(x=>x.classList.toggle("on",x===b));
    document.querySelectorAll(".dbf").forEach(el=>
      el.style.display=el.dataset.for===dbEngine?"":"none");
    if(dbEngine==="postgres")loadPgContainers();
  });
  $("#dbRun").onclick=dbRun;
  $("#dbSql").addEventListener("keydown",e=>{
    if((e.ctrlKey||e.metaKey)&&e.key==="Enter")dbRun();});
}
async function loadPgContainers(){
  try{
    const r=await api("/api/pgcontainers");
    const sel=$("#dbContainer");
    sel.innerHTML='<option value="">— host psql —</option>'+
      (r.containers||[]).map(c=>`<option value="${esc(c.name)}">${esc(c.name)} (${esc(c.image)})</option>`).join("");
  }catch(e){}
}
async function dbRun(){
  const body={engine:dbEngine,sql:$("#dbSql").value,write:$("#dbWrite").checked};
  if(dbEngine==="sqlite")body.path=$("#dbPath").value.trim();
  else{body.conn=$("#dbConn").value.trim();body.container=$("#dbContainer").value;}
  $("#dbStat").textContent="running…";
  try{
    const r=await api("/api/dbquery",{method:"POST",body:JSON.stringify(body)});
    $("#dbStat").textContent=r.columns&&r.columns.length
      ?`${r.rows.length} row(s)`:`ok (${r.rowcount} affected)`;
    if(r.tables)$("#dbTables").innerHTML="tables: "+r.tables.map(t=>
      `<button class="btn small" data-tbl="${esc(t)}">${esc(t)}</button>`).join(" ");
    document.querySelectorAll("[data-tbl]").forEach(b=>b.onclick=()=>{
      $("#dbSql").value=`SELECT * FROM ${b.dataset.tbl} LIMIT 100;`;dbRun();});
    const cols=r.columns||[];
    $("#dbResult").innerHTML=cols.length
      ?`<thead><tr>${cols.map(c=>`<th>${esc(c)}</th>`).join("")}</tr></thead>`+
       `<tbody>${r.rows.map(row=>`<tr>${row.map(v=>
        `<td class="mono" style="font-size:12px">${esc(v==null?"∅":String(v))}</td>`).join("")}</tr>`).join("")}</tbody>`
      :"";
  }catch(e){$("#dbStat").textContent="";toast(e.message,false);}
}

/* ---- simple mode: hide developer tooling for non-developer users ---- */
const SIMPLE_TABS=["term","net","dev","db","git","api","runtimes","tools","kernel"];
function applySimple(){
  const on=localStorage.perchSimple==="1";
  SIMPLE_TABS.forEach(t=>{
    const b=document.querySelector(`nav button[data-tab="${t}"]`);
    if(b)b.style.display=on?"none":"";
  });
  const g=$("#ngDev");if(g)g.style.display=on?"none":"";
  const tog=$("#simpleTog");
  if(tog)tog.textContent=on?"🟢 On":"⚪ Off";
  if(on&&SIMPLE_TABS.includes(location.hash.replace("#","")))goTab("overview");
}
$("#simpleTog")&&($("#simpleTog").onclick=()=>{
  localStorage.perchSimple=localStorage.perchSimple==="1"?"0":"1";
  applySimple();
  toast(localStorage.perchSimple==="1"?"simple mode on":"simple mode off");
});
applySimple();

/* ---- reduce effects: strip blur/gradient/glow/animation for weak GPUs ---- */
function applyReduceFx(){
  const on=localStorage.perchReduceFx==="1";
  document.documentElement.classList.toggle("reduce-fx",on);
  const t=$("#fxTog");if(t)t.textContent=on?"🟢 On":"⚪ Off";
}
$("#fxTog")&&($("#fxTog").onclick=()=>{
  localStorage.perchReduceFx=localStorage.perchReduceFx==="1"?"0":"1";
  applyReduceFx();
  toast(localStorage.perchReduceFx==="1"?"reduced effects on":"full effects on");
});
applyReduceFx();

let CAPS=null;
async function loadCaps(){
  try{CAPS=await api("/api/caps");applyCaps();
    if(!CAPS.ai){const b=$("#aiFab");if(b)b.style.display="none";aiClose();}
  }catch(e){}
}
function applyCaps(){
  if(!CAPS)return;
  const hide=(sel,ok)=>document.querySelectorAll(sel).forEach(el=>
    el.style.display=ok?"":"none");
  hide(".cap-edit,#codeHere",!!CAPS.editor);
  hide(".cap-term,#termHere",true);   // built-in web terminal is always available
  hide(".cap-open",CAPS.opener);
  hide(".cap-gnome",CAPS.gnome!==false);
  hide(".cap-snap",CAPS.snap!==false);
  hide(".cap-flatpak",CAPS.flatpak!==false);
  if(CAPS.native_pm)$("#pkgNativeH").textContent=CAPS.native_pm.toUpperCase();
  if(CAPS.editor&&CAPS.editor!=="code")
    $("#codeHere").textContent="⌨ Editor here";
}
loadCaps();
loadAbout();

/* ---- in-dashboard preview (no desktop apps needed) ---- */
async function showPreview(path,kind){
  const url="/api/raw?path="+encodeURIComponent(path)+"&t="+TOKEN;
  const body=$("#lbBody");
  $("#lbName").textContent=path;
  if(kind==="office"){
    body.innerHTML='<div class="muted" style="color:#fff">rendering…</div>';
    $("#lightbox").style.display="flex";
    try{
      const d=await api("/api/office?path="+encodeURIComponent(path));
      let html='<div class="panel" style="width:min(880px,90vw);max-height:84vh;overflow:auto;margin:0;background:var(--surface)">';
      if(d.kind==="docx"){
        html+=d.blocks.map(b=>b.h?`<h2 style="margin:12px 0 4px">${esc(b.text)}</h2>`
          :`<p style="margin:6px 0;font-size:13.5px">${esc(b.text)}</p>`).join("");
        d.tables.forEach(t=>{html+='<table style="margin:10px 0">'+
          t.map(row=>"<tr>"+row.map(c=>`<td style="border:1px solid var(--grid);padding:3px 7px">${esc(c)}</td>`).join("")+"</tr>").join("")+"</table>";});
      }else if(d.kind==="xlsx"){
        d.sheets.forEach(sh=>{
          html+=`<h2 style="margin:10px 0 4px">${esc(sh.name)} <span class="muted" style="font-size:11px">${esc(sh.dims)}</span></h2>`;
          html+='<div style="overflow-x:auto"><table class="mono" style="font-size:11.5px">'+
            sh.rows.map((row,i)=>"<tr>"+row.map(c=>`<${i?"td":"th"} style="border:1px solid var(--grid);padding:2px 6px;white-space:nowrap">${esc(c)}</${i?"td":"th"}>`).join("")+"</tr>").join("")+"</table></div>";
        });
      }
      body.innerHTML=html+"</div>";
    }catch(e){body.innerHTML=`<div style="color:#fff">⚠ ${esc(e.message)}</div>`;}
    return;
  }
  if(kind==="image")body.innerHTML=`<img src="${url}" style="max-width:100%;max-height:82vh;border-radius:8px;background:#fff">`;
  else if(kind==="pdf")body.innerHTML=`<iframe src="${url}" style="width:88vw;height:82vh;border:0;border-radius:8px;background:#fff"></iframe>`;
  else if(kind==="video")body.innerHTML=`<video src="${url}" controls autoplay style="max-width:100%;max-height:82vh;border-radius:8px"></video>`;
  else if(kind==="audio")body.innerHTML=`<audio src="${url}" controls autoplay style="width:70vw"></audio>`;
  $("#lightbox").style.display="flex";
}
$("#lbClose").onclick=()=>{$("#lbBody").innerHTML="";$("#lightbox").style.display="none";};
$("#lightbox").onclick=e=>{if(e.target.id==="lightbox")$("#lbClose").click();};
document.addEventListener("keydown",e=>{
  if(e.key==="Escape"&&$("#lightbox").style.display==="flex")$("#lbClose").click();});

async function openPath(p){
  try{await api("/api/open",{method:"POST",body:JSON.stringify({path:p})});
    toast("opened with default app");}
  catch(e){toast(e.message,false);}
}

/* ---- search ---- */
function idxLine(s){
  if(s.index==="building")return"indexing the filesystem… searches work once it finishes";
  if(s.index==="ready")return`${(s.count/1e6).toFixed(1).replace(/\.0$/,"")}M files indexed · ${fmtDur((Date.now()/1000)-s.built)} ago`;
  if(s.index==="error")return"index failed — hit Rebuild";
  return"index not built yet";
}
async function searchStatus(){
  try{const r=await api("/api/search?q=");$("#sqStatus").textContent=idxLine(r.status);}
  catch(e){}
}
$("#sq").oninput=()=>{clearTimeout(window._sq);window._sq=setTimeout(runSearch,350);};
$("#sqRe").onchange=runSearch;
async function runSearch(){
  const q=$("#sq").value.trim();
  if(q.length<2)return;
  $("#sqStatus").textContent="searching…";
  try{
    const r=await api("/api/search?q="+encodeURIComponent(q)+
      ($("#sqRe").checked?"&regex=1":""));
    $("#sqStatus").textContent=(r.note?r.note+" · ":"")+
      `${r.results.length} result${r.results.length===1?"":"s"}`+
      (r.truncated?" (more exist — narrow the search)":"")+" · "+idxLine(r.status);
    $("#stable tbody").innerHTML=r.results.map(f=>{
      const dir=f.dir,parent=f.path.slice(0,f.path.lastIndexOf("/"))||"/";
      return `<tr>
        <td><span class="name" data-p="${esc(f.path)}" data-dir="${dir}">${dir?"📁":"📄"} <b>${esc(f.path.split("/").pop())}</b></span></td>
        <td class="mono muted" style="font-size:11.5px;max-width:380px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(parent)}</td>
        <td class="num">${dir?"—":fmtB(f.size)}</td>
        <td class="num muted">${ago(f.mtime)}</td>
        <td class="num" style="white-space:nowrap">
          <button class="btn small" data-open="${esc(f.path)}">Open</button>
          <button class="btn small" data-goto="${esc(dir?f.path:parent)}">Browse</button>
          <button class="btn small" data-edit="${esc(f.path)}">Code</button></td></tr>`;
    }).join("")||`<tr><td colspan=5 class="muted" style="padding:14px">no matches</td></tr>`;
    hookRowActions($("#stable"));
  }catch(e){$("#sqStatus").textContent="";toast(e.message,false);}
}
$("#reindex").onclick=async()=>{
  await api("/api/reindex",{method:"POST",body:"{}"});
  toast("rebuilding index in the background");
  setTimeout(searchStatus,1500);
};
function hookRowActions(root){
  root.querySelectorAll(".name").forEach(n=>n.onclick=()=>{
    if(n.dataset.dir==="true")gotoFiles(n.dataset.p);else openPath(n.dataset.p);});
  root.querySelectorAll("[data-open]").forEach(b=>b.onclick=()=>openPath(b.dataset.open));
  root.querySelectorAll("[data-goto]").forEach(b=>b.onclick=()=>gotoFiles(b.dataset.goto));
  root.querySelectorAll("[data-edit]").forEach(b=>b.onclick=async()=>{
    try{const r=await api("/api/editor",{method:"POST",
      body:JSON.stringify({path:b.dataset.edit})});toast("opened in "+r.editor);}
    catch(e){toast(e.message,false);}});
  root.querySelectorAll("[data-term]").forEach(b=>b.onclick=()=>
    openInTerminal({cwd:b.dataset.term,
      name:(b.dataset.term.split("/").pop()||"shell")}));
}
function gotoFiles(p){
  document.querySelector('nav button[data-tab="files"]').onclick();
  loadFiles(p);
}

/* ---- file search on the home screen (same index as the Search tab) ---- */
function ovSqFull(){
  const q=$("#ovSq").value.trim();
  goTab("search");
  if(q.length>=2){$("#sq").value=q;$("#sqRe").checked=$("#ovSqRe").checked;runSearch();}
}
async function ovRunSearch(){
  const q=$("#ovSq").value.trim();
  if(q.length<2){$("#ovSqOut").innerHTML="";
    $("#ovSqStatus").textContent=q?"type at least 2 characters":"";return;}
  $("#ovSqStatus").textContent="searching…";
  try{
    const r=await api("/api/search?q="+encodeURIComponent(q)+
      ($("#ovSqRe").checked?"&regex=1":""));
    const shown=r.results.slice(0,8);
    $("#ovSqStatus").textContent=(r.note?r.note+" · ":"")+
      `${r.results.length} result${r.results.length===1?"":"s"}`+
      (r.truncated?" (more exist — narrow it down)":"");
    const box=$("#ovSqOut");
    if(!shown.length){
      box.innerHTML='<span class="muted" style="font-size:12.5px">no matches</span>';
      return;}
    box.innerHTML='<table><tbody>'+shown.map(f=>{
      const parent=f.path.slice(0,f.path.lastIndexOf("/"))||"/";
      return `<tr>
        <td><span class="name" data-p="${esc(f.path)}" data-dir="${f.dir}">${f.dir?"📁":"📄"}
          <b>${esc(f.path.split("/").pop())}</b></span>
          <div class="mono muted" style="font-size:10.5px;max-width:520px;overflow:hidden;
            text-overflow:ellipsis;white-space:nowrap">${esc(parent)}</div></td>
        <td class="num">${f.dir?"—":fmtB(f.size)}</td>
        <td class="num muted" style="font-size:11.5px">${ago(f.mtime)}</td>
        <td class="num" style="white-space:nowrap">
          <button class="btn small" data-open="${esc(f.path)}">Open</button>
          <button class="btn small" data-goto="${esc(f.dir?f.path:parent)}">Browse</button>
        </td></tr>`;}).join("")+'</tbody></table>'+
      (r.results.length>shown.length
        ?`<div class="muted" style="font-size:11.5px;margin-top:6px">showing the top
           ${shown.length} of ${r.results.length} — press Enter for all results</div>`:"");
    hookRowActions(box);
  }catch(e){$("#ovSqStatus").textContent="";toast(e.message,false);}
}
$("#ovSq")&&($("#ovSq").oninput=()=>{clearTimeout(window._ovsq);
  window._ovsq=setTimeout(ovRunSearch,350);});
$("#ovSq")&&($("#ovSq").onkeydown=e=>{if(e.key==="Enter"){e.preventDefault();ovSqFull();}});
$("#ovSqRe")&&($("#ovSqRe").onchange=ovRunSearch);
$("#ovSqFull")&&($("#ovSqFull").onclick=ovSqFull);

/* ---- network ---- */
let netData=null;
async function loadNet(){
  loadFirewall();
  try{
    netData=await api("/api/net");
    $("#estCount").textContent=`· ${netData.established} established connections`;
    renderPorts();
    $("#ifaces").innerHTML=netData.ifaces.map(i=>`
      <span class="pill" style="margin:3px 6px 3px 0">
      ${i.up?"🟢":"⚪"} <b>${esc(i.nic)}</b> ${i.ips.map(esc).join(", ")}</span>`).join("")
      ||'<span class="muted">no interfaces up</span>';
  }catch(e){toast(e.message,false);}
}
/* ---- firewall (status unprivileged, rule dump via pkexec) ---- */
async function loadFirewall(){
  const body=$("#fwBody");if(!body)return;
  try{
    const f=await api("/api/firewall");
    if(!f.any){
      $("#fwState").textContent="— none detected";
      body.innerHTML='<span class="muted">no firewall tool installed '+
        '(looked for ufw, firewalld, nftables)</span>';
      $("#fwRules").style.display="none";return;}
    $("#fwRules").style.display=f.can_dump?"":"none";
    const on=f.ufw_enabled;
    $("#fwState").innerHTML=on===true?'— <b style="color:var(--goodtext)">on</b>'
      :on===false?'— <b style="color:var(--serious)">off</b>':"";
    body.innerHTML=Object.entries(f.tools).map(([name,t])=>`
      <span class="pill" style="margin:3px 6px 3px 0">
        ${t.service==="active"?"🟢":"⚪"} <b>${esc(name)}</b>
        service ${esc(t.service)}${t.enabled===false?" · not enabled":
          t.enabled===true?" · enabled":""}</span>`).join("")+
      (on===false?'<div style="margin-top:6px;color:var(--serious)">⚠ ufw is '+
        'installed but not enabled — inbound ports are not being filtered.</div>':"");
  }catch(e){body.innerHTML='<span class="muted">firewall status unavailable</span>';}
}
$("#fwRules")&&($("#fwRules").onclick=()=>{
  if(!confirm("Show the live firewall rules?\nThis needs admin rights — a password dialog appears."))return;
  runJob(api("/api/firewallrules",{method:"POST",body:"{}"}));});

/* ---- drive health ---- */
async function loadDiskHealth(){
  const body=$("#dhBody");if(!body)return;
  try{
    const d=await api("/api/diskhealth");
    if(!d.devices.length){body.innerHTML='<span class="muted">no physical devices found</span>';return;}
    body.innerHTML='<table><thead><tr><th>Device</th><th>Model</th>'+
      '<th class="num">Size</th><th>Type</th><th></th></tr></thead><tbody>'+
      d.devices.map(x=>`<tr>
        <td class="mono"><b>/dev/${esc(x.name)}</b></td>
        <td class="muted">${esc([x.vendor,x.model].filter(Boolean).join(" ")||"—")}</td>
        <td class="num">${fmtB(x.size)}</td>
        <td>${x.rotational?"spinning disk":"SSD / flash"}${x.readonly?" · read-only":""}</td>
        <td class="num">${d.smartctl?`<button class="btn small" data-smart="${esc(x.name)}">SMART check</button>`:""}</td>
      </tr>`).join("")+'</tbody></table>'+
      (d.smartctl?'<div class="muted" style="font-size:11.5px;margin-top:6px">'+
        'SMART needs admin rights — a password dialog appears and the report '+
        'streams into the job box.</div>'
       :'<div class="muted" style="font-size:11.5px;margin-top:6px">Install '+
        '<code>smartmontools</code> to read drive health (wear, reallocated '+
        'sectors, hours powered on).</div>');
    body.querySelectorAll("[data-smart]").forEach(b=>b.onclick=()=>
      runJob(api("/api/smart",{method:"POST",
        body:JSON.stringify({device:b.dataset.smart})})));
  }catch(e){body.innerHTML='<span class="muted">drive list unavailable</span>';}
}

/* ---- docker disk usage ---- */
async function loadDockerDisk(){
  const box=$("#dockerDisk");if(!box)return;
  try{
    const d=await api("/api/dockerdisk");
    box.innerHTML='<h2 style="margin:10px 0 4px">Disk usage</h2>'+
      '<table><thead><tr><th>Type</th><th class="num">Items</th>'+
      '<th class="num">Active</th><th class="num">Size</th>'+
      '<th class="num">Reclaimable</th></tr></thead><tbody>'+
      d.usage.map(u=>`<tr><td><b>${esc(u.type)}</b></td>
        <td class="num">${esc(String(u.total))}</td>
        <td class="num muted">${esc(String(u.active))}</td>
        <td class="num">${esc(u.size)}</td>
        <td class="num" style="color:var(--s2)">${esc(u.reclaimable)}</td></tr>`).join("")+
      '</tbody></table>'+
      (d.volumes.length?'<div class="muted" style="font-size:11.5px;margin-top:6px">volumes: '+
        d.volumes.slice(0,12).map(v=>`<span class="pill" style="margin:2px 4px 2px 0">${esc(v.name)}</span>`).join("")+
        (d.volumes.length>12?` +${d.volumes.length-12} more`:"")+'</div>':"");
  }catch(e){box.innerHTML="";}
}

function renderPorts(){
  if(!netData)return;
  const q=($("#portQ").value||"").trim().toLowerCase();
  const pubOnly=$("#portPub").checked;
  const rows=netData.listen.filter(p=>
    (!pubOnly||p.public)&&
    (!q||String(p.port).includes(q)||(p.name||"").toLowerCase().includes(q)||
     (p.cmd||"").toLowerCase().includes(q)||(p.addr||"").includes(q)));
  $("#ports tbody").innerHTML=rows.map(p=>{
    const stop=!p.pid
      ?'<span class="muted" style="font-size:12px">owner hidden</span>'
      :p.self
        ?'<span class="muted" style="font-size:12px">Perch itself</span>'
        :p.mine
          ?`<button class="btn small danger" data-stop="${p.port}" data-pid="${p.pid}">Stop</button>
            <button class="btn small danger" data-force="${p.port}" data-pid="${p.pid}">Force</button>`
          :`<button class="btn small" data-sudo="${p.pid}"
              title="another user owns this — copy the command and run it in a terminal">⧉ sudo kill</button>`;
    return `<tr><td class="num"><b>${p.port}</b></td>
      <td class="mono">${esc(p.addr)}</td>
      <td>${p.public?'<span class="pill">⚠ network-visible</span>':'<span class="muted">localhost only</span>'}</td>
      <td>${p.name?`<b>${esc(p.name)}</b>`:'<span class="muted">—</span>'}
        ${p.user?` <span class="muted" style="font-size:11px">${esc(p.user)}</span>`:""}
        ${p.cmd?`<div class="mono muted" style="font-size:10.5px;max-width:340px;
          overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
          title="${esc(p.cmd)}">${esc(p.cmd)}</div>`:""}</td>
      <td class="num mono">${p.pid??"—"}</td>
      <td style="white-space:nowrap">${stop}</td></tr>`;}).join("")
    ||`<tr><td colspan=6 class="muted" style="padding:12px">no listening ports match</td></tr>`;
  const stopPort=async(port,pid,force)=>{
    const p=netData.listen.find(x=>x.port===+port&&x.pid===+pid)||{};
    if(!confirm(`${force?"Force kill":"Stop"} ${p.name||"the process"} `+
      `(pid ${pid}) listening on port ${port}?`+
      (force?"\n\nSIGKILL is immediate — unsaved state is lost."
            :"\n\nIt is asked to shut down cleanly (SIGTERM).")))return;
    try{const r=await api("/api/killport",{method:"POST",
      body:JSON.stringify({port:+port,pid:+pid,force})});
      toast(`stopped ${r.name}`);setTimeout(loadNet,700);}
    catch(e){toast(e.message,false);}
  };
  $("#ports").querySelectorAll("[data-stop]").forEach(b=>
    b.onclick=()=>stopPort(b.dataset.stop,b.dataset.pid,false));
  $("#ports").querySelectorAll("[data-force]").forEach(b=>
    b.onclick=()=>stopPort(b.dataset.force,b.dataset.pid,true));
  $("#ports").querySelectorAll("[data-sudo]").forEach(b=>
    b.onclick=()=>copyText("sudo kill "+b.dataset.sudo));
}
$("#netReload")&&($("#netReload").onclick=loadNet);
$("#portQ")&&($("#portQ").oninput=renderPorts);
$("#portPub")&&($("#portPub").onchange=renderPorts);

/* ---- dev ---- */
async function loadDev(){
  loadDocker();loadServices();loadTools();loadDockerStats();loadCompose();
  loadContainers();loadDockerDisk();
}
/* ---- other container environments: podman / nerdctl / LXD / kubernetes ---- */
const CTR_STATE_DOT=s=>s==="running"?"🟢":s==="paused"?"🟡":
  (s==="exited"||s==="stopped")?"⚪":"🔴";
async function loadContainers(){
  const panel=$("#ctrPanel");if(!panel)return;
  try{
    const d=await api("/api/containers");
    // docker has its own panel above — only surface the *other* environments
    const envs=d.envs.filter(e=>e.engine!=="docker");
    const k8s=d.k8s;
    if(!envs.length&&!k8s){panel.style.display="none";return;}
    panel.style.display="";
    let html=envs.map(e=>{
      const head=`<h2 style="margin:6px 0 4px">${esc(e.engine)}
        <span class="muted" style="font-weight:400">${esc(e.version||"")} ·
        ${e.containers.length} container${e.containers.length===1?"":"s"}</span></h2>`;
      if(e.error)return head+`<div class="muted" style="font-size:12.5px">⚠ ${esc(e.error)}</div>`;
      if(!e.containers.length)return head+'<div class="muted" style="font-size:12.5px">no containers</div>';
      return head+`<table><thead><tr><th>Name</th><th>Image</th><th>State</th>
        <th>Ports</th><th></th></tr></thead><tbody>`+
        e.containers.map(c=>`<tr>
          <td><b>${esc(c.name)}</b></td>
          <td class="mono" style="font-size:11.5px">${esc(c.image)}</td>
          <td>${CTR_STATE_DOT(c.state)} ${esc(c.status||c.state)}</td>
          <td class="mono" style="font-size:11px">${esc(c.ports||"—")}</td>
          <td class="num" style="white-space:nowrap">${e.kind==="lxd"?"":
            (c.state==="running"
              ?`<button class="btn small" data-ct="stop" data-eng="${esc(e.engine)}" data-id="${esc(c.id)}">Stop</button>
                <button class="btn small" data-ct="restart" data-eng="${esc(e.engine)}" data-id="${esc(c.id)}">Restart</button>
                <button class="btn small" data-ctexec="${esc(c.id)}" data-eng="${esc(e.engine)}">Shell</button>`
              :`<button class="btn small" data-ct="start" data-eng="${esc(e.engine)}" data-id="${esc(c.id)}">Start</button>
                <button class="btn small danger" data-ct="rm" data-eng="${esc(e.engine)}" data-id="${esc(c.id)}">Remove</button>`)+
            `<button class="btn small" data-ctlog="${esc(c.id)}" data-eng="${esc(e.engine)}">Logs</button>`}
          </td></tr>`).join("")+`</tbody></table>`;
    }).join("");
    if(k8s){
      html+=`<h2 style="margin:14px 0 4px">kubernetes
        <span class="muted" style="font-weight:400">context ${esc(k8s.context||"—")} ·
        ${k8s.pods.length} pod${k8s.pods.length===1?"":"s"}</span></h2>`;
      html+=k8s.error?`<div class="muted" style="font-size:12.5px">⚠ ${esc(k8s.error)}</div>`
        :k8s.pods.length?`<table><thead><tr><th>Namespace</th><th>Pod</th>
          <th>Status</th><th class="num">Ready</th><th class="num">Restarts</th>
          <th>Node</th><th></th></tr></thead><tbody>`+
          k8s.pods.map(p=>`<tr>
            <td class="muted">${esc(p.ns)}</td>
            <td><b>${esc(p.name)}</b>${p.ip?`<div class="mono muted" style="font-size:10.5px">${esc(p.ip)}</div>`:""}</td>
            <td>${p.phase==="Running"?"🟢":p.phase==="Succeeded"?"⚪":"🔴"} ${esc(p.phase)}</td>
            <td class="num">${esc(p.ready)}</td>
            <td class="num">${p.restarts}</td>
            <td class="muted mono" style="font-size:11px">${esc(p.node||"")}</td>
            <td class="num"><button class="btn small" data-ctlog="${esc(p.name)}"
              data-eng="k8s" data-ns="${esc(p.ns)}">Logs</button></td></tr>`).join("")+
          `</tbody></table>`
        :'<div class="muted" style="font-size:12.5px">no pods</div>';
    }
    $("#ctrBody").innerHTML=html;
    $("#ctrBody").querySelectorAll("[data-ct]").forEach(b=>b.onclick=async()=>{
      if(b.dataset.ct==="rm"&&
         !confirm("Remove this container? Its writable layer is lost."))return;
      b.disabled=true;
      try{await api("/api/ctraction",{method:"POST",body:JSON.stringify(
        {engine:b.dataset.eng,id:b.dataset.id,action:b.dataset.ct})});
        toast(`${b.dataset.eng} ${b.dataset.ct} ✓`);loadContainers();}
      catch(e){toast(e.message,false);b.disabled=false;}});
    $("#ctrBody").querySelectorAll("[data-ctlog]").forEach(b=>b.onclick=async()=>{
      const pre=$("#ctrLogs");pre.style.display="block";pre.textContent="loading…";
      try{const r=await api("/api/ctrlogs?engine="+encodeURIComponent(b.dataset.eng)+
        "&id="+encodeURIComponent(b.dataset.ctlog)+
        (b.dataset.ns?"&ns="+encodeURIComponent(b.dataset.ns):""));
        pre.textContent=r.logs||"(no output)";pre.scrollTop=pre.scrollHeight;}
      catch(e){pre.textContent="";toast(e.message,false);}});
    $("#ctrBody").querySelectorAll("[data-ctexec]").forEach(b=>b.onclick=()=>
      openInTerminal({name:b.dataset.eng,
        cmd:`${b.dataset.eng} exec -it ${b.dataset.ctexec} sh -c 'exec bash 2>/dev/null || exec sh'`}));
  }catch(e){panel.style.display="none";}
}
$("#ctrReload")&&($("#ctrReload").onclick=loadContainers);
$("#dockerReload").onclick=()=>{loadDocker();loadDockerStats();loadCompose();};
$("#dockerPruneImg")&&($("#dockerPruneImg").onclick=()=>{
  if(confirm("Remove all dangling images?"))
    runJob(api("/api/dockerprune",{method:"POST",body:JSON.stringify({kind:"images"})}));});
$("#dockerPruneSys")&&($("#dockerPruneSys").onclick=()=>{
  if(confirm("Prune stopped containers, unused networks and dangling images?"))
    runJob(api("/api/dockerprune",{method:"POST",body:JSON.stringify({kind:"system"})}));});
async function loadDockerStats(){
  try{
    const d=await api("/api/dockerstats");
    if(!d.stats.length){$("#dockerStats").innerHTML="";return;}
    $("#dockerStats").innerHTML='<h2 style="margin:6px 0 4px">Live stats</h2>'+
      '<table><thead><tr><th>Container</th><th class="num">CPU</th><th class="num">Mem</th><th>Memory</th><th>Net I/O</th><th>Block I/O</th></tr></thead><tbody>'+
      d.stats.map(s=>`<tr><td><b>${esc(s.name)}</b></td>
        <td class="num">${esc(s.cpu||"")}</td><td class="num">${esc(s.mem||"")}</td>
        <td class="mono" style="font-size:11px">${esc(s.memuse||"")}</td>
        <td class="mono" style="font-size:11px">${esc(s.net||"")}</td>
        <td class="mono" style="font-size:11px">${esc(s.block||"")}</td></tr>`).join("")+
      '</tbody></table>';
  }catch(e){$("#dockerStats").innerHTML="";}
}
async function loadCompose(){
  try{
    const d=await api("/api/dockercompose");
    if(!d.projects.length){$("#dockerCompose").innerHTML="";return;}
    $("#dockerCompose").innerHTML='<h2 style="margin:10px 0 4px">Compose projects</h2>'+
      d.projects.map(p=>`<div class="row" style="margin-bottom:6px">
        <span class="pill">${esc(p.name)} · ${p.running}/${p.total} up</span>
        <button class="btn small" data-cp="up" data-proj="${esc(p.name)}">Up</button>
        <button class="btn small" data-cp="restart" data-proj="${esc(p.name)}">Restart</button>
        <button class="btn small danger" data-cp="down" data-proj="${esc(p.name)}">Down</button></div>`).join("");
    document.querySelectorAll("[data-cp]").forEach(b=>b.onclick=()=>runJob(
      api("/api/composeaction",{method:"POST",
        body:JSON.stringify({project:b.dataset.proj,action:b.dataset.cp})})));
  }catch(e){$("#dockerCompose").innerHTML="";}
}
async function loadDocker(){
  $("#dockerBody").textContent="querying docker…";
  try{
    const d=await api("/api/docker");
    $("#dockerBody").innerHTML=d.containers.length?`<table><thead>
      <tr><th>Name</th><th>Image</th><th>State</th><th>Ports</th><th></th></tr></thead><tbody>`+
      d.containers.map(c=>`
      <tr><td><b>${esc(c.name)}</b></td><td class="mono" style="font-size:12px">${esc(c.image)}</td>
      <td>${c.state==="running"?"🟢":"⚪"} ${esc(c.status)}</td>
      <td class="mono" style="font-size:11.5px">${esc(c.ports||"—")}</td>
      <td class="num" style="white-space:nowrap">
        ${c.state==="running"
          ?`<button class="btn small" data-dk="stop" data-id="${c.id}">Stop</button>
            <button class="btn small" data-dk="restart" data-id="${c.id}">Restart</button>
            <button class="btn small" data-dkexec="${c.id}">Shell</button>`
          :`<button class="btn small" data-dk="start" data-id="${c.id}">Start</button>
            <button class="btn small danger" data-dk="rm" data-id="${c.id}">Remove</button>`}
        <button class="btn small" data-dklog="${c.id}">Logs</button></td></tr>`).join("")+
      `</tbody></table>`:'<span class="muted">no containers</span>';
    $("#dockerImgs").innerHTML=d.images.length?`<span class="muted" style="font-size:12px">images: </span>`+
      d.images.map(i=>`<span class="pill" style="margin:2px 4px 2px 0">${esc(i.repo)}:${esc(i.tag)} · ${esc(i.size)}</span>`).join(""):"";
    document.querySelectorAll("[data-dk]").forEach(b=>b.onclick=async()=>{
      if(b.dataset.dk==="rm"&&!confirm("Remove this container? Its writable layer is lost."))return;
      b.disabled=true;
      try{await api("/api/dockeraction",{method:"POST",
        body:JSON.stringify({id:b.dataset.id,action:b.dataset.dk})});
        toast(`docker ${b.dataset.dk} ✓`);loadDocker();}
      catch(e){toast(e.message,false);b.disabled=false;}});
    document.querySelectorAll("[data-dklog]").forEach(b=>b.onclick=async()=>{
      try{const r=await api("/api/dockerlogs?id="+b.dataset.dklog);
        const pre=$("#dockerLogs");pre.style.display="block";
        pre.textContent=r.logs||"(no output)";pre.scrollTop=pre.scrollHeight;}
      catch(e){toast(e.message,false);}});
    document.querySelectorAll("[data-dkexec]").forEach(b=>b.onclick=()=>
      openInTerminal({name:"docker",
        cmd:`docker exec -it ${b.dataset.dkexec} sh -c 'exec bash 2>/dev/null || exec sh'`}));
  }catch(e){$("#dockerBody").innerHTML=`<span class="muted">${esc(e.message)}</span>`;}
}
async function loadServices(){
  try{
    const s=await api("/api/services");
    $("#svct tbody").innerHTML=s.user.map(u=>`
      <tr><td class="mono" style="font-size:12px">${esc(u.name)}</td>
      <td>${u.active==="active"?"🟢":u.active==="failed"?"🔴":"⚪"} ${esc(u.sub)}</td>
      <td>${u.enabled==="enabled"?'<span class="pill">starts at login</span>'
        :u.enabled==="disabled"?'<span class="muted">manual</span>':""}</td>
      <td class="muted">${esc(u.desc)}</td>
      <td class="num" style="white-space:nowrap">
        <button class="btn small" data-svc="restart" data-name="${esc(u.name)}">Restart</button>
        ${u.active==="active"?`<button class="btn small danger" data-svc="stop" data-name="${esc(u.name)}">Stop</button>`
          :`<button class="btn small" data-svc="start" data-name="${esc(u.name)}">Start</button>`}
        ${u.enabled==="enabled"
          ?`<button class="btn small" data-svc="disable" data-name="${esc(u.name)}">Disable</button>`
          :u.enabled==="disabled"
            ?`<button class="btn small" data-svc="enable" data-name="${esc(u.name)}">Enable</button>`:""}
      </td></tr>`).join("");
    $("#svcFailed").innerHTML=s.failed_system.length?
      `<b style="color:var(--crit)">⚠ failed system services:</b> `+
      s.failed_system.map(f=>`<span class="pill">${esc(f.name)}</span>`).join(" ")+
      `<div class="muted" style="font-size:12px;margin-top:4px">inspect with
       <code>systemctl status &lt;name&gt;</code> — system scope needs sudo to restart</div>`
      :'<span class="muted" style="font-size:12.5px">no failed system services 🎉</span>';
    document.querySelectorAll("[data-svc]").forEach(b=>b.onclick=async()=>{
      if(b.dataset.name==="perch.service"&&b.dataset.svc!=="restart"&&
         !confirm("This is the dashboard itself — stopping it kills this page. Continue?"))return;
      try{await api("/api/serviceaction",{method:"POST",
        body:JSON.stringify({name:b.dataset.name,action:b.dataset.svc})});
        toast(`${b.dataset.svc} ✓`);setTimeout(loadServices,700);}
      catch(e){toast(e.message,false);}});
  }catch(e){toast(e.message,false);}
}
async function loadTools(){
  try{
    const d=await api("/api/devinfo");
    $("#tools").innerHTML=`<table><tbody>`+d.tools.map(t=>`
      <tr><td style="width:120px"><b>${esc(t.tool)}</b></td>
      <td class="mono" style="font-size:12px">${esc(t.version)}</td></tr>`).join("")+
      `</tbody></table>`+
      (d.git["user.name"]?`<div class="muted" style="margin-top:8px;font-size:12.5px">
        git identity: <b style="color:var(--ink)">${esc(d.git["user.name"])}</b>
        &lt;${esc(d.git["user.email"]||"?")}&gt;</div>`:"");
  }catch(e){}
}

