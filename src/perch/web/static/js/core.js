/* Perch — helpers, tabs, palette, jobs, packages, settings, theme.
   Part of the frontend, split positionally from one file: the
   scripts are loaded in order and share one global scope, so
   execution order is exactly as it was. */
const $=s=>document.querySelector(s);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
async function api(path,opts){
  const r=await fetch(path,{...opts,headers:{"X-Token":TOKEN,
    ...(opts&&opts.body?{"Content-Type":"application/json"}:{})}});
  const j=await r.json();
  if(!r.ok) throw new Error(j.error||r.statusText);
  return j;
}
function toast(msg,ok=true){const t=$("#toast");
  t.textContent=(ok?"✓ ":"⚠ ")+msg;t.style.display="block";
  clearTimeout(t._h);t._h=setTimeout(()=>t.style.display="none",4200);}
function fmtB(n){if(n==null)return"–";const u=["B","KB","MB","GB","TB"];let i=0;
  while(n>=1024&&i<u.length-1){n/=1024;i++}
  return (n>=10||i===0?Math.round(n):n.toFixed(1))+" "+u[i];}
function fmtDur(s){const d=Math.floor(s/86400),h=Math.floor(s%86400/3600),
  m=Math.floor(s%3600/60);
  return d?`${d}d ${h}h`:(h?`${h}h ${m}m`:`${m}m`);}
function ago(ts){return new Date(ts*1000).toLocaleString([],
  {month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"});}
function usageColor(p){return p>=90?"var(--crit)":p>=75?"var(--serious)":"var(--s1)";}
function usageNote(p){return p>=90?" · critical — nearly full":p>=75?" · getting full":"";}

/* ---- theme ---- */
$("#themeBtn").onclick=()=>{
  const r=document.documentElement;
  const dark=matchMedia("(prefers-color-scheme: dark)").matches;
  const cur=r.dataset.theme||(dark?"dark":"light");
  r.dataset.theme=cur==="dark"?"light":"dark";
  localStorage.theme=r.dataset.theme;
};
if(localStorage.theme)document.documentElement.dataset.theme=localStorage.theme;

/* ---- tabs ---- */
document.querySelectorAll("nav button[data-tab]").forEach(b=>b.onclick=()=>{
  location.hash=b.dataset.tab;
  document.querySelectorAll("nav button").forEach(x=>x.classList.remove("active"));
  b.classList.add("active");
  document.querySelectorAll("section").forEach(s=>s.classList.remove("on"));
  $("#tab-"+b.dataset.tab).classList.add("on");
  ({overview:refreshHome,storage:loadStorage,proc:loadProcs,users:loadUsers,
    files:()=>loadFiles(fPath),clean:loadClean,
    search:()=>{$("#sq").focus();searchStatus();},
    net:loadNet,dev:loadDev,kernel:loadKernel,
    logs:()=>{if(!$("#logView").innerHTML)loadLogs(false);},
    monitor:loadMonitor,security:loadSecurity,fleet:loadFleet,
    updates:loadUpdates,packages:()=>{$("#pkgQ").focus();loadInstalled();},
    settings:loadSettings,runtimes:loadRuntimes,term:openTerminal,
    db:loadDb,git:loadGit,api:loadApiClient,tools:loadSched}[b.dataset.tab]||(()=>{}))();
});
function goTab(name){
  const b=document.querySelector(`nav button[data-tab="${CSS.escape(name)}"]`);
  if(b)b.onclick();
}

const startTab=location.hash.replace("#","");
// deferred so every `let` (fPath, duPath, …) is initialized before a deep-link
// handler runs, avoiding a temporal-dead-zone error
if(startTab)setTimeout(()=>{
  const b=document.querySelector(`nav button[data-tab="${CSS.escape(startTab)}"]`);
  if(b)b.onclick();},0);

/* ---- sparklines ---- */
function spark(svg,series,max){
  const w=svg.clientWidth||260,h=44;svg.setAttribute("viewBox",`0 0 ${w} ${h}`);
  let out=`<line x1="0" y1="${h-1}" x2="${w}" y2="${h-1}" stroke="var(--axis)" stroke-width="1"/>`;
  for(const s of series){
    if(s.data.length<2)continue;
    const n=s.data.length;
    const pts=s.data.map((v,i)=>`${(i/(n-1))*w},${h-2-Math.min(1,v/max)*(h-6)}`).join(" ");
    out+=`<polyline points="${pts}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
  }
  svg.innerHTML=out;
}

/* ---- overview ---- */
async function loadOverview(){
  try{
    const [o,hist]=await Promise.all([api("/api/overview"),api("/api/history")]);
    $("#host").textContent=o.hostname;
    $("#sysline").textContent=`${o.os} · ${o.cores} cores`+
      (o.freq?` @ ${(o.freq/1000).toFixed(1)} GHz`:"");
    $("#cpuV").textContent=o.cpu.toFixed(0)+"%";
    $("#cpuD").textContent=`load ${o.load.join(" / ")}`;
    sbSet("cpu",o.cpu);sbSet("mem",o.mem.percent);sbSet("disk",rootPct);
    $("#memV").textContent=o.mem.percent.toFixed(0)+"%";
    $("#memD").textContent=`${fmtB(o.mem.used)} of ${fmtB(o.mem.total)} · swap ${fmtB(o.swap.used)}`;
    const last=hist[hist.length-1]||{down:0,up:0};
    $("#netV").textContent=fmtB(last.down)+"/s";
    $("#netD").textContent=`↓ ${fmtB(last.down)}/s · ↑ ${fmtB(last.up)}/s`;
    $("#upV").textContent=fmtDur(o.uptime);
    $("#loadD").textContent=`load avg ${o.load.join(" / ")}`;
    if(o.battery){
      $("#batV").textContent=o.battery.percent+"%";
      $("#batD").textContent=(o.battery.plugged?"🔌 plugged in":"🔋 on battery")+
        (o.battery.secsleft?` · ~${fmtDur(o.battery.secsleft)} left`:"");
    }else{$("#batV").textContent="—";$("#batD").textContent="no battery detected";}
    if(o.temps.length){
      const hot=o.temps.reduce((a,b)=>a.c>b.c?a:b);
      $("#tmpV").textContent=hot.c+"°C";
      $("#tmpD").textContent=o.temps.map(t=>`${t.label} ${t.c}°`).slice(0,3).join(" · ");
    }else{$("#tmpV").textContent="—";$("#tmpD").textContent="no sensors";}
    $("#npD").textContent=`${o.nproc} processes`;
    const dlast=hist[hist.length-1]||{dr:0,dw:0};
    $("#dioV").textContent=fmtB((dlast.dr||0)+(dlast.dw||0))+"/s";
    $("#dioD").textContent=`R ${fmtB(dlast.dr||0)}/s · W ${fmtB(dlast.dw||0)}/s`;
    const busiest=Math.max(...o.percore);
    $("#coreV").textContent=busiest.toFixed(0)+"%";
    $("#coreD").textContent="busiest core";
    $("#cores").innerHTML=o.percore.map(p=>
      `<i style="height:${Math.max(4,p)}%" title="${p.toFixed(0)}%"></i>`).join("");
    try{
      const g=await api("/api/gpu");
      if(g.cur!=null||g.busy!=null){
        $("#gpuV").textContent=g.busy!=null?g.busy.toFixed(0)+"%":g.cur+" MHz";
        $("#gpuN").textContent="";
        const topg=g.top&&g.top[0]?` · top: ${g.top[0].name} ${g.top[0].busy}%`:"";
        $("#gpuD").textContent=`${g.cur??"?"} / ${g.max??"?"} MHz${topg}`;
        $("#gpuD").title=g.name;
      }else{$("#gpuV").textContent="—";$("#gpuD").textContent=g.name;}
    }catch(e){}
    const css=getComputedStyle(document.documentElement);
    const gdata=hist.map(h=>h.gpu).filter(v=>v!=null);
    if(gdata.length>1)spark($("#gpuS"),[{data:hist.map(h=>h.gpu||0),color:css.getPropertyValue("--s3")}],100);
    spark($("#cpuS"),[{data:hist.map(h=>h.cpu),color:css.getPropertyValue("--s1")}],100);
    spark($("#memS"),[{data:hist.map(h=>h.mem),color:css.getPropertyValue("--s1")}],100);
    const nmax=Math.max(1024,...hist.map(h=>Math.max(h.down,h.up)));
    spark($("#netS"),[{data:hist.map(h=>h.down),color:css.getPropertyValue("--s1")},
                      {data:hist.map(h=>h.up),color:css.getPropertyValue("--s2")}],nmax);
    const dmax=Math.max(65536,...hist.map(h=>Math.max(h.dr||0,h.dw||0)));
    spark($("#dioS"),[{data:hist.map(h=>h.dr||0),color:css.getPropertyValue("--s1")},
                      {data:hist.map(h=>h.dw||0),color:css.getPropertyValue("--s2")}],dmax);
    const tdata=hist.map(h=>h.temp).filter(v=>v!=null);
    if(tdata.length>1)spark($("#tmpS"),[{data:hist.map(h=>h.temp||0),color:css.getPropertyValue("--s2")}],105);
  }catch(e){/* transient */}
}
async function loadHW(){
  try{
    const h=await api("/api/hw");
    const kv=(k,v)=>v?`<div style="display:flex;gap:8px;padding:4px 0;
      border-bottom:1px solid var(--grid)"><span class="muted" style="width:130px;
      flex:none;font-size:12.5px">${k}</span><span style="font-size:13px">${v}</span></div>`:"";
    const b=h.battery||{},w=h.wifi||{};
    $("#hwGrid").innerHTML=`<div style="display:grid;
      grid-template-columns:repeat(auto-fit,minmax(330px,1fr));gap:4px 34px">`+
      kv("Model",esc(h.model||"")+(h.product?` <span class="muted">(${esc(h.product)})</span>`:""))+
      kv("BIOS",esc(h.bios||""))+
      kv("CPU",esc(h.cpu||""))+
      kv("GPU",esc(h.gpu||""))+
      kv("RAM",h.ram_gb?h.ram_gb+" GB":null)+
      kv("Battery health",b.health!=null?`${b.health}% of design capacity · <b>${esc(b.cycles||"?")}</b> charge cycles`:null)+
      kv("Battery now",b.status?`${esc(b.status)}${b.capacity?` · ${b.capacity}%`:""}${b.power_w?` · drawing ${b.power_w} W`:""}`:null)+
      kv("Wi-Fi",w.ssid?`${esc(w.ssid)}${w.signal?` · signal ${esc(w.signal)}%`:""}${w.dbm?` (${w.dbm} dBm)`:""}`:null)+
      kv("Screen brightness",h.brightness!=null?h.brightness+"%":null)+
      `</div>`;
    if(b.health!=null)$("#batH").textContent=`health ${b.health}% · ${b.cycles||"?"} cycles`;
  }catch(e){}
}
/* ---- sidebar live mini-stats ---- */
$("#sbStats").innerHTML=["cpu","mem","disk"].map(k=>`
  <div class="srow"><b>${k.toUpperCase()}</b>
  <div class="bar"><i id="sb_${k}" style="width:0%"></i></div>
  <span class="val" id="sbv_${k}">–</span></div>`).join("");
let rootPct=null;
function sbSet(k,p){
  if(p==null)return;
  const el=$("#sb_"+k);el.style.width=p+"%";
  el.style.background=usageColor(p);
  $("#sbv_"+k).textContent=p.toFixed(0)+"%";
}
async function loadDiskPct(){
  try{const ds=await api("/api/disks");
    const root=ds.find(d=>d.mount==="/")||ds[0];
    rootPct=root?root.percent:null;sbSet("disk",rootPct);}catch(e){}
}
loadDiskPct();setInterval(loadDiskPct,120000);

/* ---- updates ---- */
async function loadUpdates(force){
  $("#updMeta").innerHTML='<span class="muted">checking…</span>';
  try{
    const u=await api("/api/updates"+(force?"?force=1":""));
    const badge=$("#updBadge");
    badge.style.display=u.count?"inline-block":"none";
    badge.textContent=u.count;
    if(u.security)badge.style.background="var(--crit)";
    $("#updMeta").innerHTML=`
      <span class="pill">${u.count} upgradable</span>
      ${u.security?`<span class="pill" style="border-color:var(--crit);color:var(--crit)">⚠ ${u.security} security</span>`:""}
      ${u.lists_updated?`<span class="muted" style="font-size:12px">package lists from ${new Date(u.lists_updated*1000).toLocaleString()}</span>`:""}`;
    $("#updTable tbody").innerHTML=u.packages.map(p=>`
      <tr><td><b>${esc(p.name)}</b>${p.security?' <span class="pill" style="border-color:var(--crit);color:var(--crit);font-size:10.5px">security</span>':""}</td>
      <td class="mono muted" style="font-size:11.5px">${esc(p.old)}</td>
      <td class="mono" style="font-size:11.5px">→ ${esc(p.new)}</td>
      <td class="muted" style="font-size:11.5px">${esc(p.repo)}</td></tr>`).join("")
      ||`<tr><td class="muted" style="padding:12px">everything is up to date 🎉</td></tr>`;
  }catch(e){$("#updMeta").innerHTML="";toast(e.message,false);}
}
$("#updReload")&&($("#updReload").onclick=()=>loadUpdates(true));
setTimeout(()=>loadUpdates(false),4000);

/* ---- command palette ---- */
const PAL_ITEMS=[
  ...[["overview","📈 Overview"],["monitor","🚨 Monitor"],["proc","⚙️ Processes"],
     ["logs","📜 Logs"],["kernel","🧬 Kernel"],["updates","📦 Updates"],
     ["users","👤 Users"],["storage","💾 Storage"],["files","📁 Files"],
     ["search","🔍 Search"],["clean","🧹 Clean up"],["net","🌐 Network"],
     ["dev","🧰 Dev"],["tools","🔧 Tools"]]
    .map(([t,l])=>({label:l,hint:"tab",act:()=>goTab(t)})),
  {label:"✨ Ask the assistant",hint:"action",act:()=>aiOpen()},
  {label:"🔒 Security overview",hint:"tab",act:()=>goTab("security")},
  {label:"🛰️ Fleet — other machines",hint:"tab",act:()=>goTab("fleet")},
  {label:"⌨ Keyboard shortcuts",hint:"action",act:()=>keyHelpOpen()},
  {label:"⬇ Export history as CSV",hint:"action",act:()=>{goTab("monitor");
    setTimeout(()=>$("#monExport").click(),400);}},
  {label:"🔁 Rebuild file index",hint:"action",act:()=>$("#reindex").click()},
  {label:"🔔 Send test notification",hint:"action",act:()=>$("#monTest").click()},
  {label:"⏸ Stop / start alerts",hint:"action",
   act:()=>alertCtl(acCtl.enabled===false?"start":"stop")},
  {label:"😴 Snooze alerts for an hour",hint:"action",act:()=>alertCtl("snooze",60)},
  {label:"🔍 Find a file from the home screen",hint:"action",
   act:()=>{goTab("overview");$("#ovSq").focus();}},
  {label:"🧩 Add a widget to the home screen",hint:"action",
   act:()=>{goTab("overview");galOpen();}},
  {label:"✎ Customize the home screen",hint:"action",
   act:()=>{goTab("overview");if(!ovEditing)$("#ovCustomize").click();}},
  {label:"📝 New file here",hint:"action",act:()=>{goTab("files");$("#newFile").click();}},
  {label:"🎨 New sketch",hint:"action",act:()=>{goTab("files");$("#newSketch").click();}},
  {label:"🖥 Open terminal in current folder",hint:"action",act:()=>{goTab("files");$("#termHere").click();}},
  {label:"🚀 Run speed test",hint:"action",act:()=>{goTab("net");$("#speedGo").click();}},
  {label:"🌓 Toggle theme",hint:"action",act:()=>$("#themeBtn").click()},
];
let palSel=0,palShown=[];
function palRender(){
  const q=$("#palIn").value.trim().toLowerCase();
  palShown=PAL_ITEMS.filter(i=>i.label.toLowerCase().includes(q));
  if(q.length>=2)palShown.push({label:`🔍 Search files for “${q}”`,hint:"enter",
    act:()=>{goTab("search");$("#sq").value=q;runSearch();}});
  palSel=Math.min(palSel,Math.max(0,palShown.length-1));
  $("#palList").innerHTML=palShown.map((i,ix)=>
    `<div class="palItem${ix===palSel?" sel":""}" data-ix="${ix}">${i.label}
     <span class="hint">${i.hint}</span></div>`).join("")
    ||'<div class="palItem muted">no matches</div>';
  document.querySelectorAll(".palItem[data-ix]").forEach(el=>{
    el.onclick=()=>{palClose();palShown[+el.dataset.ix].act();};
    el.onmousemove=()=>{palSel=+el.dataset.ix;
      document.querySelectorAll(".palItem").forEach((x,i2)=>
        x.classList.toggle("sel",i2===palSel));};
  });
}
function palOpen(){$("#pal").classList.add("open");$("#palIn").value="";
  palSel=0;palRender();setTimeout(()=>$("#palIn").focus(),40);}
function palClose(){$("#pal").classList.remove("open");}
document.addEventListener("keydown",e=>{
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="k"){
    e.preventDefault();
    $("#pal").classList.contains("open")?palClose():palOpen();return;}
  if(!$("#pal").classList.contains("open"))return;
  if(e.key==="Escape"){palClose();}
  else if(e.key==="ArrowDown"){e.preventDefault();
    palSel=Math.min(palSel+1,palShown.length-1);palRender();}
  else if(e.key==="ArrowUp"){e.preventDefault();
    palSel=Math.max(palSel-1,0);palRender();}
  else if(e.key==="Enter"&&palShown[palSel]){e.preventDefault();
    palClose();palShown[palSel].act();}
});
$("#palIn")&&($("#palIn").oninput=()=>{palSel=0;palRender();});
$("#pal").onclick=e=>{if(e.target.id==="pal")palClose();};

/* ---- speed test ---- */
$("#speedGo").onclick=async()=>{
  $("#speedGo").disabled=true;
  $("#speedOut").innerHTML='<span class="muted">testing… ~5-20 s</span>';
  try{
    const s=await api("/api/speedtest");
    $("#speedOut").innerHTML=`
      <span class="pill">⬇ <b>${s.mbps} Mbps</b></span>
      ${s.ping_ms!=null?`<span class="pill">ping <b>${s.ping_ms} ms</b></span>`:""}
      ${s.ip?`<span class="pill">public IP <b>${esc(s.ip)}</b></span>`:""}
      <span class="muted" style="font-size:12px">${s.mb} MB in ${s.secs}s</span>`;
  }catch(e){$("#speedOut").innerHTML="";toast(e.message,false);}
  $("#speedGo").disabled=false;
};

/* ---- process detail ---- */
async function procModal(pid){
  try{
    const p=await api("/api/procinfo?pid="+pid);
    $("#lbName").textContent=`${p.name} — PID ${p.pid}`;
    const row=(k,v)=>v!=null&&v!==""?`<tr><td class="muted" style="width:110px">${k}</td>
      <td class="mono" style="font-size:12px;word-break:break-all">${esc(String(v))}</td></tr>`:"";
    $("#lbBody").innerHTML=`<div class="panel" style="max-width:760px;width:88vw;
      max-height:80vh;overflow:auto;margin:0"><table><tbody>
      ${row("command",p.cmdline||p.name)}
      ${row("executable",p.exe)}
      ${row("working dir",p.cwd)}
      ${row("user",p.user)}${row("status",p.status)}
      ${row("started",new Date(p.started*1000).toLocaleString())}
      ${row("CPU",p.cpu.toFixed(1)+" %")}
      ${row("memory",fmtB(p.rss)+" resident · "+fmtB(p.vms)+" virtual")}
      ${row("threads",p.threads)}${row("open fds",p.fds)}
      ${row("connections",p.conns)}${row("nice",p.nice)}
      ${row("parent",p.parent)}
      ${row("children",p.children.join(", "))}
      </tbody></table></div>`;
    $("#lightbox").style.display="flex";
  }catch(e){toast(e.message,false);}
}
/* ---- job runner (shared live-output box) ---- */
let jobPoll=null;
async function runJob(startPromise){
  try{
    const {id}=await startPromise;
    $("#jobBox").style.display="block";
    $("#jobOut").textContent="";
    let since=0;
    clearInterval(jobPoll);
    const tick=async()=>{
      try{
        const s=await api("/api/job?id="+id+"&since="+since);
        since=s.total;
        $("#jobTitle").textContent=s.title;
        if(s.lines.length)$("#jobOut").textContent+=s.lines.join("\n")+"\n";
        $("#jobOut").scrollTop=$("#jobOut").scrollHeight;
        const st=$("#jobState");
        st.textContent=s.status;
        st.style.borderColor=s.status==="done"?"var(--good)":
          s.status==="failed"?"var(--crit)":"var(--border)";
        if(s.status!=="running"){clearInterval(jobPoll);
          if(s.status==="done"){toast("finished ✓");
            if($("#tab-updates").classList.contains("on"))loadUpdates(true);
            if($("#tab-runtimes").classList.contains("on"))loadRuntimes();
            if($("#tab-packages").classList.contains("on"))$("#pkgGo").click();}}
      }catch(e){clearInterval(jobPoll);}
    };
    jobPoll=setInterval(tick,900);tick();
  }catch(e){toast(e.message,false);}
}
$("#jobClose").onclick=()=>{$("#jobBox").style.display="none";clearInterval(jobPoll);};

/* ---- updates: upgrade actions ---- */
$("#updApt")&&($("#updApt").onclick=()=>runJob(
  api("/api/upgradeall",{method:"POST",body:JSON.stringify({mgr:"native"})})));
$("#updSnap")&&($("#updSnap").onclick=()=>runJob(
  api("/api/upgradeall",{method:"POST",body:JSON.stringify({mgr:"snap"})})));

/* ---- packages: search + install ---- */
async function pkgSearch(){
  const q=$("#pkgQ").value.trim();
  if(q.length<2)return;
  $("#pkgStat").textContent="searching…";
  try{
    const r=await api("/api/pkgsearch?q="+encodeURIComponent(q));
    const nat=r.native||[],pm=r.native_pm||"native";
    $("#pkgStat").textContent=`${nat.length} ${pm} · ${(r.snap||[]).length} snap`+
      (CAPS&&CAPS.flatpak?` · ${(r.flatpak||[]).length} flatpak`:"");
    const row=(p,mgr,sub)=>`<tr><td><b>${esc(p.title||p.name)}</b> <span class="muted" style="font-size:11px">${esc(sub||"")}</span><br>
      <span class="muted" style="font-size:11.5px">${esc(p.desc)}</span></td>
      <td class="num" style="white-space:nowrap">${p.installed
        ?`<span class="muted">installed</span>
          <button class="btn small danger" data-pk="${mgr}-remove" data-pn="${esc(p.name)}">Remove</button>`
        :`<button class="btn small" data-pk="${mgr}" data-pn="${esc(p.name)}">Install</button>`}</td></tr>`;
    $("#pkgApt").innerHTML=nat.length?`<table><tbody>${nat.map(p=>row(p,"native")).join("")}</tbody></table>`:`<span class="muted">no ${pm} matches</span>`;
    $("#pkgSnap").innerHTML=(r.snap||[]).length?`<table><tbody>${r.snap.map(p=>row(p,"snap",p.version)).join("")}</tbody></table>`:'<span class="muted">no snap matches</span>';
    $("#pkgFlat").innerHTML=(r.flatpak||[]).length?`<table><tbody>${r.flatpak.map(p=>row(p,"flatpak",p.name)).join("")}</tbody></table>`:'<span class="muted">no flatpak matches</span>';
    document.querySelectorAll("[data-pk]").forEach(b=>b.onclick=()=>{
      const rm=b.dataset.pk.includes("remove");
      if(!confirm(`${rm?"Remove":"Install"} ${b.dataset.pn}?\nA password dialog will appear.`))return;
      runJob(api("/api/pkginstall",{method:"POST",
        body:JSON.stringify({mgr:b.dataset.pk,name:b.dataset.pn})}));
    });
  }catch(e){$("#pkgStat").textContent="";toast(e.message,false);}
}
$("#pkgGo").onclick=pkgSearch;
$("#pkgQ").onkeydown=e=>{if(e.key==="Enter")pkgSearch();};

/* ---- about & self-update ---- */
let aboutInfo=null;
const INSTALL_LABEL={git:"git checkout",deb:"Debian package",pip:"pip install",
  unknown:"unknown"};
async function loadAbout(){
  try{
    aboutInfo=await api("/api/about");
    const a=aboutInfo;
    $("#brandVer").textContent="v"+a.version;
    $("#aboutVer").textContent=`— version ${a.version}`;
    const kv=(k,v)=>v?`<div style="display:flex;gap:8px;padding:3px 0;
      border-bottom:1px solid var(--grid)"><span class="muted"
      style="width:130px;flex:none">${k}</span>
      <span class="mono" style="font-size:11.5px;word-break:break-all">${esc(v)}</span></div>`:"";
    $("#aboutBody").innerHTML=
      kv("Version",a.version)+
      kv("Installed as",INSTALL_LABEL[a.install]||a.install)+
      kv("Location",a.root)+
      kv("Python",a.python)+
      kv("Service",a.service)+
      kv("Listening on",`${a.host}:${a.port}`)+
      kv("Config",a.config_dir)+
      kv("Cache",a.cache_dir)+
      kv("Updates from",a.repo);
  }catch(e){$("#aboutBody").textContent="version info unavailable";}
}
$("#updCheck")&&($("#updCheck").onclick=async()=>{
  $("#updStat").textContent="asking GitHub…";
  $("#updApply").style.display="none";$("#updNotes").style.display="none";
  try{
    const u=await api("/api/perchupdate");
    if(u.newer){
      $("#updStat").innerHTML=`<b style="color:var(--s2)">${esc(u.latest)} is available</b>
        (you have ${esc(u.current)})`;
      $("#updApply").style.display="";
      $("#updApply").textContent=`Update to ${u.latest}`;
      $("#brandVer").textContent="v"+u.current+" ▲";
      $("#brandVer").classList.add("new");
      $("#brandVer").title=`${u.latest} is available — see Settings › About`;
      if(u.notes){$("#updNotes").style.display="";
        $("#updNotes").textContent=u.notes;}
    }else{
      $("#updStat").textContent=`you're on the latest release (${u.current})`;
    }
  }catch(e){$("#updStat").textContent="";toast(e.message,false);}
});
$("#updApply")&&($("#updApply").onclick=async()=>{
  const how=aboutInfo&&aboutInfo.install;
  if(!confirm(how==="git"
    ?"Fast-forward this checkout to the latest release and then restart Perch?"
    :"Download the latest release and install it?\nA password dialog appears."))return;
  try{
    await runJob(api("/api/perchupdate",{method:"POST",body:"{}"}));
    $("#updStat").innerHTML='updated — <b>restart Perch</b> to run the new version';
  }catch(e){toast(e.message,false);}
});
$("#perchRestart")&&($("#perchRestart").onclick=async()=>{
  if(!confirm("Restart the Perch service?\nThis page will reconnect in a few seconds."))return;
  try{await api("/api/perchrestart",{method:"POST",body:"{}"});
    toast("restarting — reloading shortly");
    setTimeout(()=>location.reload(),6000);}
  catch(e){toast(e.message,false);}
});

/* ---- installed packages (every manager present) ---- */
let instMgr="native",instData=null;
async function loadInstalled(){
  const tb=$("#instTable tbody");if(!tb)return;
  tb.innerHTML='<tr><td colspan=4 class="muted" style="padding:12px">reading the package database…</td></tr>';
  try{
    instData=await api("/api/installed?mgr="+encodeURIComponent(instMgr)+
      "&q="+encodeURIComponent(($("#instQ").value||"").trim())+
      "&sort="+encodeURIComponent($("#instSort").value));
    renderInstalled();
  }catch(e){tb.innerHTML=`<tr><td colspan=4 class="muted" style="padding:12px">${esc(e.message)}</td></tr>`;}
}
function renderInstalled(){
  const d=instData;if(!d)return;
  const onlyUpg=$("#instUpg").checked;
  const rows=d.packages.filter(p=>!onlyUpg||p.upgradable);
  $("#instCount").textContent=`— ${d.total} installed`+
    (d.matched!==d.total?` · ${d.matched} match`:"")+
    (d.bytes?` · ${fmtB(d.bytes)}`:"");
  const sfx={native:"native",snap:"snap",flatpak:"flatpak"}[d.mgr];
  $("#instTable tbody").innerHTML=rows.map(p=>`
    <tr><td><b>${esc(p.name)}</b>
      ${p.upgradable?'<span class="pill" style="border-color:var(--s2);color:var(--s2);font-size:10.5px">update</span>':""}
      ${p.summary?`<div class="muted" style="font-size:11px;max-width:520px;
        overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.summary)}</div>`:""}</td>
    <td class="mono" style="font-size:11.5px">${esc(p.version)}</td>
    <td class="num">${p.size?fmtB(p.size):"—"}</td>
    <td class="num" style="white-space:nowrap">
      <button class="btn small" data-pkgup="${esc(p.name)}" data-sfx="${sfx}">Update</button>
      <button class="btn small danger" data-pkgrm="${esc(p.name)}" data-sfx="${sfx}">Remove</button>
    </td></tr>`).join("")
    ||`<tr><td colspan=4 class="muted" style="padding:12px">no packages match</td></tr>`;
  if(d.truncated)$("#instCount").textContent+=" · showing the first "+d.packages.length;
  $("#instTable").querySelectorAll("[data-pkgup]").forEach(b=>b.onclick=()=>
    runJob(api("/api/pkginstall",{method:"POST",body:JSON.stringify(
      {mgr:b.dataset.sfx+"-update",name:b.dataset.pkgup})})));
  $("#instTable").querySelectorAll("[data-pkgrm]").forEach(b=>b.onclick=()=>{
    if(!confirm(`Remove ${b.dataset.pkgrm}?\n\nAnything depending on it may be `+
      `removed too — the package manager lists what it will do in the job output.`))return;
    runJob(api("/api/pkginstall",{method:"POST",body:JSON.stringify(
      {mgr:b.dataset.sfx+"-remove",name:b.dataset.pkgrm})}));});
}
$("#instMgr")&&$("#instMgr").querySelectorAll("[data-mgr]").forEach(b=>b.onclick=()=>{
  if(b.dataset.mgr===instMgr)return;
  $("#instMgr").querySelectorAll("button").forEach(x=>x.classList.remove("on"));
  b.classList.add("on");instMgr=b.dataset.mgr;
  // a filter typed for one manager almost never matches the next one, and an
  // empty table reads as "nothing installed" rather than "nothing matched"
  $("#instQ").value="";$("#instUpg").checked=false;
  loadInstalled();});
$("#instQ")&&($("#instQ").oninput=()=>{clearTimeout(window._instq);
  window._instq=setTimeout(loadInstalled,350);});
$("#instSort")&&($("#instSort").onchange=loadInstalled);
$("#instUpg")&&($("#instUpg").onchange=renderInstalled);
$("#instReload")&&($("#instReload").onclick=loadInstalled);

/* ---- settings ---- */
async function loadSettings(){
  loadLLM();loadAbout();
  try{
    const s=await api("/api/settings");
    const slider=(id,label,val,min,max,unit,key)=>`
      <div class="row" style="margin-bottom:10px"><span style="width:130px">${label}</span>
        <input type="range" id="${id}" min="${min}" max="${max}" value="${val??min}"
          data-key="${key}" style="flex:1;max-width:320px" ${val==null?"disabled":""}>
        <span class="val mono" id="${id}v" style="width:48px">${val==null?"n/a":val+unit}</span></div>`;
    const toggle=(id,label,on,key)=>`
      <div class="row" style="margin-bottom:10px"><span style="width:130px">${label}</span>
        ${on==null?'<span class="muted">unavailable</span>':
        `<button class="btn tog" id="${id}" data-key="${key}" data-on="${on}">${on?"🟢 On":"⚪ Off"}</button>`}</div>`;
    $("#setDisplay").innerHTML=
      slider("setBright","Brightness",s.brightness,5,100,"%","brightness")+
      slider("setVol","Volume",s.volume,0,150,"%","volume")+
      `<div class="row" style="margin-bottom:0"><span style="width:130px">Sound</span>
        <button class="btn" id="setMute">${s.muted?"🔇 Unmute":"🔊 Mute"}</button></div>`;
    $("#setConn").innerHTML=toggle("setBt","Bluetooth",s.bluetooth,"bluetooth")+
      toggle("setWifi","Wi-Fi",s.wifi,"wifi");
    document.querySelectorAll("#setDisplay input[type=range]").forEach(sl=>{
      sl.oninput=()=>$("#"+sl.id+"v").textContent=sl.value+(sl.dataset.key==="volume"||sl.dataset.key==="brightness"?"%":"");
      sl.onchange=async()=>{try{await api("/api/setsetting",{method:"POST",
        body:JSON.stringify({key:sl.dataset.key,value:+sl.value})});}catch(e){toast(e.message,false);}};
    });
    $("#setMute").onclick=async()=>{await api("/api/setsetting",{method:"POST",
      body:JSON.stringify({key:"mute"})});setTimeout(loadSettings,300);};
    document.querySelectorAll(".tog").forEach(b=>b.onclick=async()=>{
      try{await api("/api/setsetting",{method:"POST",body:JSON.stringify(
        {key:b.dataset.key,value:b.dataset.on!=="true"})});
        setTimeout(loadSettings,400);}catch(e){toast(e.message,false);}});
    document.querySelectorAll("#setTheme button").forEach(b=>{
      b.classList.toggle("on",b.dataset.th===s.theme);
      b.onclick=async()=>{await api("/api/setsetting",{method:"POST",
        body:JSON.stringify({key:"theme",value:b.dataset.th})});
        toast("theme changed");setTimeout(loadSettings,300);};
    });
    // power & session
    const sel=(id,val,opts,key)=>`<div class="row" style="margin-bottom:10px">
      <span style="width:130px">${id.label}</span>
      ${val==null?'<span class="muted">unavailable</span>':
      `<select class="btn setsel" data-key="${key}">`+opts.map(o=>
        `<option value="${o[0]}" ${String(o[0])===String(val)?"selected":""}>${o[1]}</option>`).join("")+`</select>`}</div>`;
    $("#setPower").innerHTML=
      sel({label:"Power mode"},s.power_profile,
          (s.power_profiles||[]).map(p=>[p,p.replace("-"," ")]),"power_profile")+
      sel({label:"Blank screen"},s.idle_blank,
          [[0,"Never"],[120,"2 min"],[300,"5 min"],[600,"10 min"],[900,"15 min"]],"idle_blank")+
      sel({label:"Suspend (AC)"},s.suspend_ac,
          [[0,"Never"],[900,"15 min"],[1800,"30 min"],[3600,"1 hour"],[7200,"2 hours"]],"suspend_ac");
    $("#setNight").innerHTML=
      toggle("setNL","Night light",s.night_light,"night_light")+
      slider("setNT","Warmth",s.night_temp,1700,6500,"K","night_temp");
    $("#setInput").innerHTML=
      toggle("setDND","Do Not Disturb",s.dnd,"dnd")+
      toggle("setBP","Battery %",s.battery_pct,"battery_pct")+
      toggle("setTC","Tap to click",s.tap_click,"tap_click")+
      toggle("setNS","Natural scroll",s.natural_scroll,"natural_scroll")+
      slider("setTS","Text size",Math.round((s.text_scale||1)*100),50,200,"%","text_scale");
    // Tweaks (GNOME Tweaks-style)
    const tw=s.tweaks||{};
    const selO=(label,val,opts,key)=>`<div class="row" style="margin-bottom:10px">
      <span style="width:130px">${label}</span>
      ${val==null?'<span class="muted">unavailable</span>':
      `<select class="btn setsel" data-key="${key}" style="max-width:280px">`+opts.map(o=>
        `<option value="${o[0]}" ${String(o[0])===String(val)?"selected":""}>${o[1]}</option>`).join("")+`</select>`}</div>`;
    const fontRow=(label,val,key)=>`<div class="row" style="margin-bottom:10px">
      <span style="width:130px">${label}</span>
      <input type="text" class="mono fontIn" data-key="${key}" list="fontFams"
        value="${(val||"").replace(/"/g,"&quot;")}" style="flex:1;max-width:240px"
        placeholder="Family Size, e.g. Ubuntu 11">
      <button class="btn small fontApply">set</button></div>`;
    const lay=s.titlebar_buttons||"";
    const layCur=lay.includes("minimize")?"min-max-close":lay.includes("maximize")?"max-close":"close";
    $("#setTweaks").innerHTML=
      selO("GTK theme",s.gtk_theme,(tw.gtk_themes||[]).map(t=>[t,t]),"gtk_theme")+
      selO("Icon theme",s.icon_theme,(tw.icon_themes||[]).map(t=>[t,t]),"icon_theme")+
      selO("Cursor theme",s.cursor_theme,(tw.cursor_themes||[]).map(t=>[t,t]),"cursor_theme")+
      `<datalist id="fontFams">${(tw.fonts||[]).map(f=>`<option value="${f} 11">`).join("")}</datalist>`+
      fontRow("Interface font",s.font_name,"font_name")+
      fontRow("Monospace font",s.mono_font,"mono_font")+
      fontRow("Document font",s.doc_font,"doc_font")+
      selO("Antialiasing",s.font_aa,[["grayscale","Standard (grayscale)"],["rgba","Subpixel (LCD)"],["none","None"]],"font_aa")+
      selO("Hinting",s.font_hint,[["slight","Slight"],["medium","Medium"],["full","Full"],["none","None"]],"font_hint")+
      selO("Titlebar buttons",layCur,[["close","Close only"],["max-close","Max + Close"],["min-max-close","Min + Max + Close"]],"titlebar_buttons")+
      toggle("twAnim","Animations",s.animations,"animations")+
      toggle("twHot","Hot corner",s.hot_corner,"hot_corner")+
      toggle("twCW","Clock: weekday",s.clock_weekday,"clock_weekday")+
      toggle("twCD","Clock: date",s.clock_date,"clock_date")+
      toggle("twCS","Clock: seconds",s.clock_seconds,"clock_seconds")+
      toggle("twWS","Dynamic workspaces",s.ws_dynamic,"ws_dynamic")+
      selO("Workspaces",s.ws_num,[1,2,3,4,5,6,7,8,9,10].map(n=>[n,String(n)]),"ws_num")+
      slider("twMS","Mouse speed",s.mouse_speed==null?null:Math.round(s.mouse_speed*100),-100,100,"","mouse_speed")+
      slider("twTS","Touchpad speed",s.touchpad_speed==null?null:Math.round(s.touchpad_speed*100),-100,100,"","touchpad_speed");
    document.querySelectorAll(".fontApply").forEach(b=>b.onclick=async()=>{
      const inp=b.previousElementSibling;
      try{await api("/api/setsetting",{method:"POST",
        body:JSON.stringify({key:inp.dataset.key,value:inp.value.trim()})});
        toast("font set");}catch(e){toast(e.message,false);}});
    // sliders in the new panels
    const fmtVal=sl=>sl.dataset.key==="night_temp"?sl.value+"K":
      sl.dataset.key.endsWith("_speed")?(sl.value/100).toFixed(2):sl.value+"%";
    document.querySelectorAll("#setNight input[type=range],#setInput input[type=range],#setTweaks input[type=range]").forEach(sl=>{
      $("#"+sl.id+"v").textContent=sl.disabled?"n/a":fmtVal(sl);
      sl.oninput=()=>$("#"+sl.id+"v").textContent=fmtVal(sl);
      sl.onchange=async()=>{
        let v=+sl.value;
        if(sl.dataset.key==="text_scale"||sl.dataset.key.endsWith("_speed"))v=v/100;
        try{await api("/api/setsetting",{method:"POST",
          body:JSON.stringify({key:sl.dataset.key,value:v})});}catch(e){toast(e.message,false);}};
    });
    document.querySelectorAll(".tog").forEach(b=>{
      if(b.id==="ssToggle")return;
      b.onclick=async()=>{try{await api("/api/setsetting",{method:"POST",
        body:JSON.stringify({key:b.dataset.key,value:b.dataset.on!=="true"})});
        setTimeout(loadSettings,400);}catch(e){toast(e.message,false);}};
    });
    document.querySelectorAll(".setsel").forEach(se=>se.onchange=async()=>{
      const v=se.value===""||isNaN(+se.value)?se.value:+se.value;
      try{await api("/api/setsetting",{method:"POST",
        body:JSON.stringify({key:se.dataset.key,value:v})});
        toast("saved");}catch(e){toast(e.message,false);}});
    // wallpaper slideshow
    const ss=s.slideshow||{};
    $("#ssFolder").value=ss.folder||"";
    $("#ssCount").textContent=ss.count!=null?ss.count+" images":"";
    $("#ssShuffle").checked=ss.shuffle!==false;
    if(ss.interval)$("#ssInterval").value=String(ss.interval);
    $("#ssToggle").dataset.on=ss.enabled?"true":"false";
    $("#ssToggle").textContent=ss.enabled?"🟢 On":"⚪ Off";
    $("#ssToggle").onclick=()=>saveSlideshow(!(ss.enabled));
  }catch(e){toast(e.message,false);}
}
async function saveSlideshow(enabled){
  try{
    await api("/api/slideshow",{method:"POST",body:JSON.stringify({
      enabled,folder:$("#ssFolder").value.trim(),
      interval:+$("#ssInterval").value,shuffle:$("#ssShuffle").checked})});
    toast(enabled?"live wallpaper on":"live wallpaper off");
    setTimeout(loadSettings,300);
  }catch(e){toast(e.message,false);}
}
$("#wpSet").onclick=async()=>{
  const p=$("#wpPath").value.trim();if(!p)return;
  try{await api("/api/setsetting",{method:"POST",
    body:JSON.stringify({key:"wallpaper",value:p})});toast("wallpaper set");}
  catch(e){toast(e.message,false);}
};

/* ===== dashboard accent theme ===== */
const ACCENTS=["#2a78d6","#1baf7a","#eb6834","#7c5cff","#e34980","#0aa2c0","#e6a400"];
function applyAccent(hex){
  document.documentElement.style.setProperty("--s1",hex);
  localStorage.perchAccent=hex;
  document.querySelectorAll(".accsw").forEach(s=>s.classList.toggle("on",s.dataset.c===hex));
  if(bgMode!=="none"&&bgMode!=="gradient")startBg(bgMode);  // recolor live bg
}
function initAccentUI(){
  const box=$("#accSwatches");if(!box)return;
  box.innerHTML=ACCENTS.map(c=>`<span class="accsw" data-c="${c}" style="background:${c}"></span>`).join("");
  box.querySelectorAll(".accsw").forEach(s=>s.onclick=()=>applyAccent(s.dataset.c));
  const cur=localStorage.perchAccent||ACCENTS[0];
  $("#accCustom").value=cur.slice(0,7);
  $("#accCustom").oninput=()=>applyAccent($("#accCustom").value);
  $("#accReset").onclick=()=>applyAccent(ACCENTS[0]);
  document.querySelectorAll(".accsw").forEach(s=>s.classList.toggle("on",s.dataset.c===cur));
  document.querySelectorAll("#bgPick button").forEach(b=>
    b.classList.toggle("on",b.dataset.bg===bgMode));
  document.querySelectorAll("#bgPick button").forEach(b=>b.onclick=()=>{
    startBg(b.dataset.bg);
    document.querySelectorAll("#bgPick button").forEach(x=>x.classList.toggle("on",x===b));});
}
if(localStorage.perchAccent)
  document.documentElement.style.setProperty("--s1",localStorage.perchAccent);

/* ===== live home background ===== */
let bgMode=localStorage.perchBg||"none",bgRAF=null,bgParts=[];
const bgCanvas=$("#bgCanvas"),bgCtx=bgCanvas.getContext("2d");
function bgAccent(){return getComputedStyle(document.documentElement).getPropertyValue("--s1").trim()||"#2a78d6";}
function bgResize(){bgCanvas.width=innerWidth;bgCanvas.height=innerHeight;}
addEventListener("resize",()=>{if(bgMode!=="none")bgResize();});
function stopBg(){if(bgRAF)cancelAnimationFrame(bgRAF);bgRAF=null;}
function startBg(mode){
  bgMode=mode;localStorage.perchBg=mode;stopBg();
  document.body.classList.toggle("has-bg",mode!=="none");
  bgCanvas.style.display=mode==="none"?"none":"block";
  if(mode==="none")return;
  bgResize();
  if(mode==="gradient"){
    const g=bgCtx.createLinearGradient(0,0,bgCanvas.width,bgCanvas.height);
    const a=bgAccent();g.addColorStop(0,a+"33");g.addColorStop(1,a+"08");
    bgCtx.fillStyle=g;bgCtx.fillRect(0,0,bgCanvas.width,bgCanvas.height);return;
  }
  if(mode==="particles"){
    bgParts=Array.from({length:70},()=>({x:Math.random()*bgCanvas.width,
      y:Math.random()*bgCanvas.height,vx:(Math.random()-.5)*.4,
      vy:(Math.random()-.5)*.4}));
    (function loop(){bgRAF=requestAnimationFrame(loop);
      bgCtx.clearRect(0,0,bgCanvas.width,bgCanvas.height);
      const a=bgAccent();
      for(const p of bgParts){p.x+=p.vx;p.y+=p.vy;
        if(p.x<0||p.x>bgCanvas.width)p.vx*=-1;
        if(p.y<0||p.y>bgCanvas.height)p.vy*=-1;}
      for(let i=0;i<bgParts.length;i++){const p=bgParts[i];
        for(let j=i+1;j<bgParts.length;j++){const q=bgParts[j];
          const d=Math.hypot(p.x-q.x,p.y-q.y);
          if(d<120){bgCtx.globalAlpha=(1-d/120)*.18;bgCtx.strokeStyle=a;
            bgCtx.beginPath();bgCtx.moveTo(p.x,p.y);bgCtx.lineTo(q.x,q.y);bgCtx.stroke();}}
        bgCtx.globalAlpha=.5;bgCtx.fillStyle=a;
        bgCtx.beginPath();bgCtx.arc(p.x,p.y,1.7,0,7);bgCtx.fill();}
      bgCtx.globalAlpha=1;})();
    return;
  }
  if(mode==="aurora"){
    let t=0;
    (function loop(){bgRAF=requestAnimationFrame(loop);t+=0.005;
      const w=bgCanvas.width,h=bgCanvas.height,a=bgAccent();
      bgCtx.clearRect(0,0,w,h);
      for(let k=0;k<3;k++){
        const x=w*(.5+.35*Math.sin(t+k*2)),y=h*(.5+.3*Math.cos(t*1.3+k));
        const r=Math.max(w,h)*.45;
        const g=bgCtx.createRadialGradient(x,y,0,x,y,r);
        g.addColorStop(0,a+(k===0?"3a":k===1?"26":"1c"));g.addColorStop(1,a+"00");
        bgCtx.fillStyle=g;bgCtx.fillRect(0,0,w,h);}
    })();
  }
}
document.addEventListener("visibilitychange",()=>{
  if(document.hidden)stopBg();
  else if(bgMode==="aurora"||bgMode==="particles")startBg(bgMode);});

