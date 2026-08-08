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
  ({storage:loadStorage,proc:loadProcs,users:loadUsers,
    files:()=>loadFiles(fPath),clean:loadClean,
    search:()=>{$("#sq").focus();searchStatus();},
    net:loadNet,dev:loadDev,kernel:loadKernel,
    logs:()=>{if(!$("#logView").innerHTML)loadLogs(false);},
    ai:()=>$("#aiIn").focus(),monitor:loadMonitor,
    updates:loadUpdates,packages:()=>$("#pkgQ").focus(),
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
     ["dev","🧰 Dev"],["tools","🔧 Tools"],["ai","✨ AI"]]
    .map(([t,l])=>({label:l,hint:"tab",act:()=>goTab(t)})),
  {label:"🔁 Rebuild file index",hint:"action",act:()=>$("#reindex").click()},
  {label:"🔔 Send test notification",hint:"action",act:()=>$("#monTest").click()},
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

/* ---- settings ---- */
async function loadSettings(){
  loadLLM();
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

/* ===== customizable home (Overview tiles) ===== */
function tileState(){try{return JSON.parse(localStorage.perchTiles||"{}");}catch(e){return {};}}
function applyTiles(){
  const st=tileState(),grid=$("#ovCards");if(!grid)return;
  const cards=[...grid.querySelectorAll(".card")];
  if(st.order)st.order.forEach(id=>{
    const c=cards.find(x=>x.dataset.tile===id);if(c)grid.appendChild(c);});
  cards.forEach(c=>c.classList.toggle("tile-hidden",
    (st.hidden||[]).includes(c.dataset.tile)));
}
function saveTiles(){
  const grid=$("#ovCards");
  const order=[...grid.querySelectorAll(".card")].map(c=>c.dataset.tile);
  const hidden=[...grid.querySelectorAll(".card.tile-hidden")].map(c=>c.dataset.tile);
  localStorage.perchTiles=JSON.stringify({order,hidden});
}
let ovEditing=false,dragEl=null;
function ovEnsureX(){
  $("#ovCards").querySelectorAll(".card").forEach(c=>{
    if(!c.querySelector(".tilex")){
      const x=document.createElement("span");x.className="tilex";x.textContent="✕";
      x.title="hide tile";x.onclick=e=>{e.stopPropagation();
        c.classList.add("tile-hidden");saveTiles();};
      c.appendChild(x);}
    c.classList.toggle("editing",ovEditing);
    c.draggable=ovEditing;
  });
}
$("#ovCustomize")&&($("#ovCustomize").onclick=()=>{
  ovEditing=!ovEditing;
  $("#ovCustomize").textContent=ovEditing?"✓ Done":"✎ Customize home";
  $("#ovReset").style.display=ovEditing?"":"none";
  // reveal hidden tiles (dimmed) while editing so they can be restored
  $("#ovCards").querySelectorAll(".card.tile-hidden").forEach(c=>{
    c.style.display=ovEditing?"":"";
    if(ovEditing){c.classList.remove("tile-hidden");c.classList.add("was-hidden");
      c.style.opacity=".4";}
  });
  if(!ovEditing){
    $("#ovCards").querySelectorAll(".was-hidden").forEach(c=>{
      c.classList.add("tile-hidden");c.classList.remove("was-hidden");c.style.opacity="";});
    saveTiles();
  }
  ovEnsureX();
});
$("#ovReset")&&($("#ovReset").onclick=()=>{
  localStorage.removeItem("perchTiles");location.reload();});
$("#ovCards")&&$("#ovCards").addEventListener("dragstart",e=>{
  if(!ovEditing)return;dragEl=e.target.closest(".card");
  if(dragEl)dragEl.classList.add("dragging");});
$("#ovCards")&&$("#ovCards").addEventListener("dragend",e=>{
  if(dragEl){dragEl.classList.remove("dragging");dragEl=null;saveTiles();}});
$("#ovCards")&&$("#ovCards").addEventListener("dragover",e=>{
  if(!ovEditing||!dragEl)return;e.preventDefault();
  const after=[...$("#ovCards").querySelectorAll(".card:not(.dragging)")].find(c=>{
    const r=c.getBoundingClientRect();
    return e.clientY<r.top+r.height/2&&e.clientX<r.right;})||null;
  if(after)$("#ovCards").insertBefore(dragEl,after);
  else $("#ovCards").appendChild(dragEl);});

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

applyTiles();
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
  loadBackup();
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
    if(!CAPS.ai){const b=document.querySelector('nav button[data-tab="ai"]');
      if(b)b.style.display="none";}
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

/* ---- network ---- */
async function loadNet(){
  try{
    const n=await api("/api/net");
    $("#estCount").textContent=`· ${n.established} established connections`;
    $("#ports tbody").innerHTML=n.listen.map(p=>`
      <tr><td class="num"><b>${p.port}</b></td>
      <td class="mono">${esc(p.addr)}</td>
      <td>${p.public?'<span class="pill">⚠ network-visible</span>':'<span class="muted">localhost only</span>'}</td>
      <td>${p.name?`<b>${esc(p.name)}</b>`:'<span class="muted">—</span>'}</td>
      <td class="num mono">${p.pid??"—"}</td>
      <td class="num">${p.mine?`<button class="btn small danger" data-port="${p.port}">Free port</button>`:""}</td></tr>`).join("");
    $("#ports").querySelectorAll("[data-port]").forEach(b=>b.onclick=async()=>{
      if(!confirm(`End the process listening on port ${b.dataset.port}?`))return;
      try{const r=await api("/api/killport",{method:"POST",
        body:JSON.stringify({port:+b.dataset.port})});
        toast(`terminated ${r.name}`);setTimeout(loadNet,700);}
      catch(e){toast(e.message,false);}});
    $("#ifaces").innerHTML=n.ifaces.map(i=>`
      <span class="pill" style="margin:3px 6px 3px 0">
      ${i.up?"🟢":"⚪"} <b>${esc(i.nic)}</b> ${i.ips.map(esc).join(", ")}</span>`).join("")
      ||'<span class="muted">no interfaces up</span>';
  }catch(e){toast(e.message,false);}
}

/* ---- dev ---- */
async function loadDev(){
  loadDocker();loadServices();loadTools();loadDockerStats();loadCompose();
}
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
      <td class="muted">${esc(u.desc)}</td>
      <td class="num" style="white-space:nowrap">
        <button class="btn small" data-svc="restart" data-name="${esc(u.name)}">Restart</button>
        ${u.active==="active"?`<button class="btn small danger" data-svc="stop" data-name="${esc(u.name)}">Stop</button>`
          :`<button class="btn small" data-svc="start" data-name="${esc(u.name)}">Start</button>`}
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

/* ---- monitor ---- */
const MON_LABELS={cpu:"CPU above % (sustained 60 s)",mem:"Memory above %",
  temp:"Temperature above °C",disk:"Any disk above % full",
  battery:"Battery below % (unplugged)"};
async function loadMonitor(){
  try{
    const m=await api("/api/monitor");
    $("#monRules tbody").innerHTML=Object.entries(m.cfg).map(([k,r])=>`
      <tr><td style="width:30px"><input type="checkbox" class="mon-on" data-k="${k}" ${r.on?"checked":""}></td>
      <td>${esc(MON_LABELS[k]||k)}</td>
      <td class="num" style="width:120px"><input type="text" class="mon-th" data-k="${k}"
        value="${r.th}" style="width:80px;min-width:80px;padding:4px 8px;text-align:right"></td></tr>`).join("");
    $("#monEvents tbody").innerHTML=m.events.length?m.events.map(e=>`
      <tr><td class="muted num" style="width:150px">${new Date(e.t*1000).toLocaleString()}</td>
      <td style="width:80px"><span class="pill">${esc(e.rule)}</span></td>
      <td>${esc(e.msg)}</td></tr>`).join("")
      :`<tr><td class="muted" style="padding:12px">no alerts fired yet 🎉</td></tr>`;
    drawMonChart(m.history);
    loadChannels();loadLogwatch();
  }catch(e){toast(e.message,false);}
}
/* ---- alert channels ---- */
let ntCfg={desktop:true,channels:[]};
async function loadChannels(){
  try{ntCfg=await api("/api/notify");renderChannels();}catch(e){}
}
function renderChannels(){
  $("#ntDesktop").checked=ntCfg.desktop!==false;
  $("#ntChannels").innerHTML=(ntCfg.channels||[]).map((c,i)=>`
    <div class="row" style="margin-bottom:6px">
      <select class="btn ntType" data-i="${i}">
        ${["ntfy","slack","discord","webhook"].map(t=>`<option value="${t}" ${t===c.type?"selected":""}>${t}</option>`).join("")}</select>
      <input type="text" class="ntUrl" data-i="${i}" value="${esc(c.url||"")}" placeholder="URL" style="flex:1;min-width:220px" class="mono">
      <label class="pill"><input type="checkbox" class="ntEn" data-i="${i}" ${c.enabled!==false?"checked":""}> on</label>
      <span class="hint" data-ntdel="${i}" style="color:var(--crit);cursor:pointer">✕</span></div>`).join("")
    ||'<span class="muted" style="font-size:12px">no channels — desktop only</span>';
  $("#ntChannels").querySelectorAll("[data-ntdel]").forEach(el=>el.onclick=()=>{
    ntCfg.channels.splice(+el.dataset.ntdel,1);renderChannels();});
}
function collectChannels(){
  ntCfg.desktop=$("#ntDesktop").checked;
  const types=[...document.querySelectorAll(".ntType")];
  const urls=[...document.querySelectorAll(".ntUrl")];
  const ens=[...document.querySelectorAll(".ntEn")];
  ntCfg.channels=types.map((t,i)=>({type:t.value,url:urls[i].value.trim(),
    enabled:ens[i].checked})).filter(c=>c.url);
}
$("#ntAdd")&&($("#ntAdd").onclick=()=>{collectChannels();
  ntCfg.channels.push({type:"ntfy",url:"",enabled:true});renderChannels();});
$("#ntSave")&&($("#ntSave").onclick=async()=>{collectChannels();
  try{await api("/api/notifyconfig",{method:"POST",body:JSON.stringify(ntCfg)});
    $("#ntStat").textContent="saved ✓";toast("channels saved");}catch(e){toast(e.message,false);}});
$("#ntTest")&&($("#ntTest").onclick=async()=>{collectChannels();
  await api("/api/notifyconfig",{method:"POST",body:JSON.stringify(ntCfg)});
  try{const r=await api("/api/testnotify",{method:"POST",body:"{}"});
    $("#ntStat").textContent=`sent to desktop + ${r.channels} channel(s)`;
    toast("test sent");}catch(e){toast(e.message,false);}});
/* ---- log-pattern watchers ---- */
let lwCfg={enabled:false,rules:[]};
async function loadLogwatch(){
  try{lwCfg=await api("/api/logwatch");renderLogwatch();}catch(e){}
}
function renderLogwatch(){
  $("#lwEnabled").checked=!!lwCfg.enabled;
  const srcOpts=t=>["system","user","kernel","file"].map(s=>`<option value="${s}" ${s===t?"selected":""}>${s}</option>`).join("");
  $("#lwRules").innerHTML=(lwCfg.rules||[]).map((r,i)=>`
    <div style="border:1px solid var(--border);border-radius:8px;padding:8px;margin-bottom:6px">
      <div class="row" style="margin-bottom:4px">
        <input type="text" class="lwName" data-i="${i}" value="${esc(r.name||"")}" placeholder="rule name" style="width:140px">
        <select class="btn lwSrc" data-i="${i}">${srcOpts(r.source)}</select>
        <input type="text" class="lwPath" data-i="${i}" value="${esc(r.path||"")}" placeholder="/path/to/file (file source only)" style="flex:1;min-width:160px" class="mono">
        <label class="pill"><input type="checkbox" class="lwEn" data-i="${i}" ${r.enabled!==false?"checked":""}> on</label>
        <span class="hint" data-lwdel="${i}" style="color:var(--crit);cursor:pointer">✕</span></div>
      <input type="text" class="lwPat" data-i="${i}" value="${esc(r.pattern||"")}" placeholder="regex, e.g. (OOM|panic|segfault|ERROR)" style="width:100%" class="mono"></div>`).join("")
    ||'<span class="muted" style="font-size:12px">no rules</span>';
  $("#lwRules").querySelectorAll("[data-lwdel]").forEach(el=>el.onclick=()=>{
    collectLogwatch();lwCfg.rules.splice(+el.dataset.lwdel,1);renderLogwatch();});
}
function collectLogwatch(){
  lwCfg.enabled=$("#lwEnabled").checked;
  const names=[...document.querySelectorAll(".lwName")];
  lwCfg.rules=names.map((n,i)=>({name:n.value.trim(),
    source:document.querySelectorAll(".lwSrc")[i].value,
    path:document.querySelectorAll(".lwPath")[i].value.trim(),
    pattern:document.querySelectorAll(".lwPat")[i].value.trim(),
    enabled:document.querySelectorAll(".lwEn")[i].checked}))
    .filter(r=>r.name&&r.pattern);
}
$("#lwAdd")&&($("#lwAdd").onclick=()=>{collectLogwatch();
  lwCfg.rules.push({name:"",source:"system",path:"",pattern:"",enabled:true});renderLogwatch();});
$("#lwSave")&&($("#lwSave").onclick=async()=>{collectLogwatch();
  try{const r=await api("/api/logwatchconfig",{method:"POST",body:JSON.stringify(lwCfg)});
    lwCfg=r;renderLogwatch();$("#lwStat").textContent=r.enabled?"watching ✓":"saved (disabled)";
    toast("log watchers saved");}catch(e){toast(e.message,false);}});
function drawMonChart(hist){
  const svg=$("#monChart");
  const w=svg.clientWidth||900,h=180;
  svg.setAttribute("viewBox",`0 0 ${w} ${h}`);
  if(hist.length<2){svg.innerHTML=`<text x="12" y="24" fill="var(--muted)"
    font-size="12">collecting… come back after a few minutes of uptime</text>`;return;}
  const css=getComputedStyle(document.documentElement);
  const series=[["cpu","--s1","CPU %"],["mem","--s2","memory %"],
                ["temp","--s3","temp °C"],["batt","--s4","battery %"]];
  const t0=hist[0].t,t1=hist[hist.length-1].t,span=Math.max(1,t1-t0);
  let out="";
  for(const y of [0,50,100]){
    const yy=h-14-(y/100)*(h-30);
    out+=`<line x1="0" y1="${yy}" x2="${w}" y2="${yy}" stroke="var(--grid)" stroke-width="1"/>
      <text x="2" y="${yy-3}" fill="var(--muted)" font-size="9">${y}</text>`;
  }
  for(const[key,cvar]of series){
    const pts=hist.filter(e=>e[key]!=null).map(e=>
      `${((e.t-t0)/span)*w},${h-14-(Math.min(100,e[key])/100)*(h-30)}`);
    if(pts.length>1)out+=`<polyline points="${pts.join(" ")}" fill="none"
      stroke="${css.getPropertyValue(cvar)}" stroke-width="1.6"
      stroke-linejoin="round"/>`;
  }
  const fmt=t=>new Date(t*1000).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"});
  out+=`<text x="2" y="${h-2}" fill="var(--muted)" font-size="9">${fmt(t0)}</text>
    <text x="${w-34}" y="${h-2}" fill="var(--muted)" font-size="9">${fmt(t1)}</text>`;
  svg.innerHTML=out;
  $("#monLegend").innerHTML=series.map(([k,c,label])=>
    `<span><i class="sw" style="background:var(${c})"></i>${label}</span>`).join("");
}
$("#monSave").onclick=async()=>{
  const cfg={};
  document.querySelectorAll(".mon-on").forEach(c=>cfg[c.dataset.k]={on:c.checked});
  document.querySelectorAll(".mon-th").forEach(i=>{
    const v=parseFloat(i.value);if(!isNaN(v))cfg[i.dataset.k].th=v;});
  try{await api("/api/monitor",{method:"POST",body:JSON.stringify(cfg)});
    $("#monStat").textContent="saved ✓";toast("alert rules saved");}
  catch(e){toast(e.message,false);}
};
$("#monTest").onclick=async()=>{
  try{await api("/api/testnotify",{method:"POST",body:"{}"});
    toast("test notification sent — check your notification area");}
  catch(e){toast(e.message,false);}
};


/* ---- tools: json ---- */
function jParse(){
  try{const o=JSON.parse($("#jIn").value);$("#jStat").textContent="";return o;}
  catch(e){$("#jStat").textContent="⚠ "+e.message;toast("invalid JSON: "+e.message,false);}
}
function jSort(o){
  if(Array.isArray(o))return o.map(jSort);
  if(o&&typeof o==="object")return Object.fromEntries(
    Object.keys(o).sort().map(k=>[k,jSort(o[k])]));
  return o;
}
function jKeys(o,prefix="",out=new Set()){
  if(Array.isArray(o)){o.forEach(v=>jKeys(v,prefix+"[]",out));}
  else if(o&&typeof o==="object"){
    for(const k of Object.keys(o)){
      const p=prefix?prefix+"."+k:k;out.add(p);jKeys(o[k],p,out);}}
  return out;
}
document.querySelectorAll("[data-j]").forEach(b=>b.onclick=async()=>{
  const act=b.dataset.j;
  if(act==="copy")return copyText($("#jOut").value);
  if(act==="y2j"||act==="j2y"){
    try{const r=await api("/api/yaml",{method:"POST",body:JSON.stringify(
      {text:$("#jIn").value,dir:act})});
      $("#jOut").value=r.text;$("#jStat").textContent="ok ✓";}
    catch(e){$("#jStat").textContent="⚠ "+e.message;toast(e.message,false);}
    return;
  }
  const o=jParse();if(o===undefined)return;
  if(act==="fmt")$("#jOut").value=JSON.stringify(o,null,2);
  if(act==="min")$("#jOut").value=JSON.stringify(o);
  if(act==="sort")$("#jOut").value=JSON.stringify(jSort(o),null,2);
  if(act==="keys"){const ks=[...jKeys(o)].join("\n");
    $("#jOut").value=ks;copyText(ks);
    $("#jStat").textContent=ks.split("\n").length+" key paths copied";}
  if(act!=="keys")$("#jStat").textContent="ok ✓";
});

/* ---- tools: converters ---- */
function b64uDecode(s){return decodeURIComponent(atob(s.replace(/-/g,"+")
  .replace(/_/g,"/")).split("").map(c=>"%"+("00"+c.charCodeAt(0).toString(16)).slice(-2)).join(""));}
document.querySelectorAll("[data-c]").forEach(b=>b.onclick=async()=>{
  const s=$("#cIn").value,O=$("#cOut");
  try{
    switch(b.dataset.c){
      case"b64e":O.value=btoa(unescape(encodeURIComponent(s)));break;
      case"b64d":O.value=decodeURIComponent(escape(atob(s.trim())));break;
      case"urle":O.value=encodeURIComponent(s);break;
      case"urld":O.value=decodeURIComponent(s);break;
      case"epoch":{let n=parseFloat(s.trim());if(isNaN(n))throw new Error("not a number");
        if(n>1e12)n/=1000;const d=new Date(n*1000);
        O.value=d.toISOString()+"\n"+d.toLocaleString();break;}
      case"now":O.value=Math.floor(Date.now()/1000)+"\n"+new Date().toISOString();break;
      case"uuid":O.value=crypto.randomUUID();break;
      case"sha":{const buf=await crypto.subtle.digest("SHA-256",
        new TextEncoder().encode(s));
        O.value=[...new Uint8Array(buf)].map(x=>x.toString(16).padStart(2,"0")).join("");break;}
      case"jwt":{const p=s.trim().split(".");
        if(p.length<2)throw new Error("not a JWT (need header.payload.signature)");
        const hdr=JSON.parse(b64uDecode(p[0])),pay=JSON.parse(b64uDecode(p[1]));
        let extra="";
        if(pay.exp)extra="\n\n// exp = "+new Date(pay.exp*1000).toLocaleString()+
          (pay.exp*1000<Date.now()?"  ⚠ EXPIRED":"  (valid)");
        O.value="// header\n"+JSON.stringify(hdr,null,2)+
          "\n\n// payload\n"+JSON.stringify(pay,null,2)+extra;break;}
    }
  }catch(e){toast(e.message,false);}
});

/* ---- tools: regex tester ---- */
function runRegex(){
  const pat=$("#rxPat").value,txt=$("#rxText").value,out=$("#rxOut");
  if(!pat||!txt){out.style.display="none";$("#rxStat").textContent="";return;}
  let re;
  try{re=new RegExp(pat,$("#rxFlags").value);}
  catch(e){$("#rxStat").textContent="⚠ "+e.message;out.style.display="none";return;}
  const matches=[...(re.global?txt.matchAll(re):(m=>m?[m]:[])(txt.match(re)))];
  $("#rxStat").textContent=matches.length+" match"+(matches.length===1?"":"es");
  let html="",last=0;
  if(re.global){
    for(const m of matches){
      html+=esc(txt.slice(last,m.index))+
        `<mark style="background:var(--s1);color:#fff;border-radius:3px;padding:0 1px">${esc(m[0]||"∅")}</mark>`;
      last=m.index+(m[0]?m[0].length:1);
      if(html.length>40000)break;
    }
    html+=esc(txt.slice(last));
  }else html=esc(txt);
  let groups="";
  matches.slice(0,10).forEach((m,i)=>{
    if(m.length>1)groups+=`\nmatch ${i+1}: `+[...m].slice(1)
      .map((g,j)=>`$${j+1}=${JSON.stringify(g)}`).join("  ");
  });
  out.innerHTML=html+(groups?`<div class="muted" style="margin-top:8px;
    border-top:1px solid var(--grid);padding-top:6px">groups:${esc(groups)}</div>`:"");
  out.style.display="block";
}
$("#rxPat").oninput=$("#rxFlags").oninput=$("#rxText").oninput=()=>{
  clearTimeout(window._rx);window._rx=setTimeout(runRegex,250);};

/* ---- tools: diff ---- */
function diffLines(a,b){
  const A=a.split("\n"),B=b.split("\n"),n=A.length,m=B.length;
  if(n*m>4e6)return null;
  const L=Array.from({length:n+1},()=>new Uint16Array(m+1));
  for(let i=n-1;i>=0;i--)for(let j=m-1;j>=0;j--)
    L[i][j]=A[i]===B[j]?L[i+1][j+1]+1:Math.max(L[i+1][j],L[i][j+1]);
  const out=[];let i=0,j=0;
  while(i<n&&j<m){
    if(A[i]===B[j]){out.push([" ",A[i]]);i++;j++;}
    else if(L[i+1][j]>=L[i][j+1])out.push(["-",A[i++]]);
    else out.push(["+",B[j++]]);
  }
  while(i<n)out.push(["-",A[i++]]);
  while(j<m)out.push(["+",B[j++]]);
  return out;
}
$("#dfGo").onclick=()=>{
  const d=diffLines($("#dfA").value,$("#dfB").value);
  if(!d){toast("too large to diff (>2000×2000 lines)",false);return;}
  const adds=d.filter(x=>x[0]==="+").length,dels=d.filter(x=>x[0]==="-").length;
  $("#dfStat").textContent=`+${adds} −${dels}`;
  $("#dfOut").innerHTML=d.map(([op,line])=>{
    const t=esc(op+" "+line);
    if(op==="+")return`<span style="color:var(--goodtext)">${t}</span>`;
    if(op==="-")return`<span style="color:var(--crit)">${t}</span>`;
    return`<span class="muted">${t}</span>`;
  }).join("\n");
  $("#dfOut").style.display="block";
};

/* ---- tools: cron ---- */
function cronField(f,min,max){
  const vals=new Set();
  for(const part of f.split(",")){
    let m;
    if((m=part.match(/^\*(?:\/(\d+))?$/))){
      const st=+(m[1]||1);for(let v=min;v<=max;v+=st)vals.add(v);}
    else if((m=part.match(/^(\d+)-(\d+)(?:\/(\d+))?$/))){
      const st=+(m[3]||1);for(let v=+m[1];v<=Math.min(+m[2],max);v+=st)vals.add(v);}
    else if((m=part.match(/^\d+$/)))vals.add(+part);
    else throw new Error("bad field: "+part);
  }
  return vals;
}
$("#cronGo").onclick=()=>{
  const parts=$("#cronIn").value.trim().split(/\s+/);
  const out=$("#cronOut");
  if(parts.length!==5){out.textContent="need 5 fields: min hour day month weekday";return;}
  try{
    const[mi,h,dom,mo,dw]=[cronField(parts[0],0,59),cronField(parts[1],0,23),
      cronField(parts[2],1,31),cronField(parts[3],1,12),cronField(parts[4],0,7)];
    if(dw.has(7))dw.add(0);
    const runs=[];const d=new Date();d.setSeconds(0,0);d.setMinutes(d.getMinutes()+1);
    for(let i=0;i<527040&&runs.length<5;i++,d.setMinutes(d.getMinutes()+1)){
      if(mi.has(d.getMinutes())&&h.has(d.getHours())&&mo.has(d.getMonth()+1)&&
         dom.has(d.getDate())&&dw.has(d.getDay()))runs.push(new Date(d));
    }
    out.textContent=runs.length?"next runs:\n"+runs.map(r=>"  "+r.toLocaleString()).join("\n")
      :"never matches in the next year";
  }catch(e){out.textContent="⚠ "+e.message;}
};

/* ---- tools: color ---- */
function parseColor(s){
  s=s.trim();let m;
  if((m=s.match(/^#?([0-9a-f]{6})$/i))){const n=parseInt(m[1],16);
    return[(n>>16)&255,(n>>8)&255,n&255];}
  if((m=s.match(/^#?([0-9a-f]{3})$/i)))
    return[...m[1]].map(c=>parseInt(c+c,16));
  if((m=s.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/)))
    return[+m[1],+m[2],+m[3]];
  return null;
}
$("#colGo").onclick=()=>{
  const rgb=parseColor($("#colIn").value);
  if(!rgb)return toast("can't parse that color (try #2a78d6)",false);
  const[r,g,b]=rgb;
  const hex="#"+rgb.map(x=>x.toString(16).padStart(2,"0")).join("");
  const rr=r/255,gg=g/255,bb=b/255;
  const mx=Math.max(rr,gg,bb),mn=Math.min(rr,gg,bb),l=(mx+mn)/2;
  let hDeg=0,sPct=0;
  if(mx!==mn){const dd=mx-mn;
    sPct=l>.5?dd/(2-mx-mn):dd/(mx+mn);
    hDeg=mx===rr?((gg-bb)/dd+(gg<bb?6:0)):mx===gg?(bb-rr)/dd+2:(rr-gg)/dd+4;
    hDeg*=60;}
  $("#colSw").style.background=hex;
  $("#colOut").textContent=
    `hex:  ${hex}\nrgb:  rgb(${r}, ${g}, ${b})\n`+
    `hsl:  hsl(${Math.round(hDeg)}, ${Math.round(sPct*100)}%, ${Math.round(l*100)}%)`;
};
/* ---- tools: case ---- */
$("#caseGo").onclick=()=>{
  const s=$("#caseIn").value.trim();
  if(!s)return;
  const words=s.replace(/([a-z])([A-Z])/g,"$1 $2")
    .split(/[\s_\-]+/).filter(Boolean).map(w=>w.toLowerCase());
  const up=w=>w[0].toUpperCase()+w.slice(1);
  $("#caseOut").textContent=
    `camelCase:      ${words[0]+words.slice(1).map(up).join("")}\n`+
    `PascalCase:     ${words.map(up).join("")}\n`+
    `snake_case:     ${words.join("_")}\n`+
    `kebab-case:     ${words.join("-")}\n`+
    `CONSTANT_CASE:  ${words.join("_").toUpperCase()}\n`+
    `Title Case:     ${words.map(up).join(" ")}\n`+
    `chars ${s.length} · words ${words.length} · bytes ${new Blob([s]).size}`;
};
/* ---- tools: secrets ---- */
$("#secGo").onclick=()=>{
  const n=Math.min(256,Math.max(4,parseInt($("#secLen").value)||32));
  let chars="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  if($("#secSym").checked)chars+="!@#$%^&*()-_=+[]{};:,.<>?";
  const buf=new Uint32Array(n);crypto.getRandomValues(buf);
  $("#secOut").textContent=[...buf].map(x=>chars[x%chars.length]).join("");
};
$("#secCopy").onclick=()=>{const s=$("#secOut").textContent;
  if(s)copyText(s);else toast("generate one first",false);};

/* ---- logs ---- */
let logCursor="",logTimer=null;
const PRIO_CLS=p=>p<=3?"err":p<=4?"warn":"";
function logRow(e){
  const d=new Date(e.t*1000);
  const ts=d.toLocaleTimeString([],{hour12:false})
  return `<div class="logrow ${PRIO_CLS(e.prio)}"><span class="lt">${ts}</span> <span class="lu">${esc(e.unit.replace(/\.service$/,""))}</span> <span class="lm">${esc(e.msg)}</span></div>`;
}
async function loadLogs(follow){
  const src=$("#logSrc").value,prio=$("#logPrio").value,q=$("#logQ").value.trim();
  try{
    const r=await api(`/api/logs?source=${src}&prio=${prio}&q=${encodeURIComponent(q)}`+
      (follow&&logCursor?`&cursor=${encodeURIComponent(logCursor)}`:"&n=200"));
    logCursor=r.cursor||logCursor;
    const v=$("#logView");
    const atBottom=v.scrollTop+v.clientHeight>=v.scrollHeight-60;
    if(follow){v.insertAdjacentHTML("beforeend",r.entries.map(logRow).join(""));
      while(v.children.length>1200)v.removeChild(v.firstChild);}
    else v.innerHTML=r.entries.map(logRow).join("")||'<div class="muted" style="padding:10px">no entries</div>';
    if(!follow||atBottom)v.scrollTop=v.scrollHeight;
    $("#logStat").textContent=(follow?"following · ":"")+new Date().toLocaleTimeString();
  }catch(e){$("#logStat").textContent="";toast(e.message,false);
    $("#logFollow").checked=false;stopFollow();}
}
function stopFollow(){if(logTimer){clearInterval(logTimer);logTimer=null;}}
$("#logGo").onclick=()=>{logCursor="";loadLogs(false);};
$("#logSrc").onchange=$("#logPrio").onchange=()=>{logCursor="";loadLogs(false);};
$("#logQ").onkeydown=e=>{if(e.key==="Enter"){logCursor="";loadLogs(false);}};
$("#logFollow").onchange=()=>{
  if($("#logFollow").checked){
    if(!logCursor)loadLogs(false).then(()=>{logTimer=setInterval(()=>loadLogs(true),2500);});
    else logTimer=setInterval(()=>loadLogs(true),2500);
  }else stopFollow();
};

/* ---- ai ---- */
function aiBubble(cls,text){
  const div=document.createElement("div");
  div.className="bubble "+cls;div.textContent=text;
  $("#aiChat").appendChild(div);
  $("#aiChat").scrollTop=$("#aiChat").scrollHeight;
  return div;
}
let aiFresh=true,aiHistory=[];  // history feeds API providers (CLI uses --resume)
async function aiAsk(q){
  q=(q||$("#aiIn").value).trim();
  if(!q)return;
  $("#aiIn").value="";
  aiBubble("me",q);
  const th=aiBubble("bot thinking","Thinking… (can take up to a minute)");
  $("#aiGo").disabled=true;
  try{
    const r=await api("/api/ai",{method:"POST",body:JSON.stringify(
      {prompt:q,snapshot:$("#aiSnap").checked,reset:aiFresh,history:aiHistory})});
    aiFresh=false;
    const text=r.text||"(empty reply)";
    aiHistory.push({role:"user",content:q},{role:"assistant",content:text});
    if(aiHistory.length>40)aiHistory=aiHistory.slice(-40);
    th.classList.remove("thinking");
    th.textContent=text;
  }catch(e){th.classList.remove("thinking");th.textContent="⚠ "+e.message;}
  $("#aiGo").disabled=false;
  $("#aiChat").scrollTop=$("#aiChat").scrollHeight;
}
$("#aiGo").onclick=()=>aiAsk();
$("#aiIn").onkeydown=e=>{
  if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();aiAsk();}};
document.querySelectorAll(".aiq").forEach(b=>b.onclick=()=>aiAsk(b.textContent));
$("#aiReset").onclick=()=>{aiFresh=true;aiHistory=[];$("#aiChat").innerHTML="";
  toast("new conversation started");};
$("#aiHealth")&&($("#aiHealth").onclick=async()=>{
  aiBubble("me","🩺 Generate a system health report");
  const th=aiBubble("bot thinking","Analyzing your system…");
  $("#aiHealth").disabled=true;
  try{const r=await api("/api/health",{method:"POST",body:"{}"});
    th.classList.remove("thinking");th.innerHTML=mdLite(r.text||"(no report)");}
  catch(e){th.classList.remove("thinking");th.textContent="⚠ "+e.message;}
  $("#aiHealth").disabled=false;
  $("#aiChat").scrollTop=$("#aiChat").scrollHeight;});
// minimal markdown → HTML for AI output (bold, code, headings, lists)
function mdLite(t){
  return esc(t)
    .replace(/^### (.*)$/gm,"<b>$1</b>")
    .replace(/\*\*(.+?)\*\*/g,"<b>$1</b>")
    .replace(/`([^`]+)`/g,'<code>$1</code>')
    .replace(/```[\w]*\n?([\s\S]*?)```/g,'<pre class="mono" style="background:var(--track);padding:8px;border-radius:6px;overflow:auto">$1</pre>')
    .replace(/\n/g,"<br>");
}

/* ---- git projects ---- */
async function loadGit(){
  $("#gitStat").textContent="scanning…";
  try{
    const d=await api("/api/gitrepos");
    $("#gitStat").textContent=`${d.repos.length} repos`;
    $("#gitTable tbody").innerHTML=d.repos.map(r=>{
      const badge=[];
      if(r.dirty)badge.push(`<span class="pill" style="border-color:var(--serious);color:var(--serious)">${r.dirty} changed</span>`);
      if(r.ahead)badge.push(`<span class="pill">↑${r.ahead}</span>`);
      if(r.behind)badge.push(`<span class="pill" style="border-color:var(--crit);color:var(--crit)">↓${r.behind}</span>`);
      if(!badge.length)badge.push('<span class="muted" style="font-size:12px">clean</span>');
      return `<tr><td><b>${esc(r.name)}</b><br>
        <span class="muted" style="font-size:11px">${esc(r.last||"")}</span></td>
        <td><span class="pill">${esc(r.branch)}</span></td>
        <td>${badge.join(" ")}</td>
        <td class="num" style="white-space:nowrap">
          <button class="btn small" data-git="fetch" data-p="${esc(r.path)}">Fetch</button>
          <button class="btn small" data-git="pull" data-p="${esc(r.path)}">Pull</button>
          <button class="btn small" data-git="stash" data-p="${esc(r.path)}">Stash</button>
          <button class="btn small" data-runp="${esc(r.path)}">Run…</button>
          <button class="btn small" data-gitterm="${esc(r.path)}">Terminal</button>
          <div class="runScripts" style="display:none;margin-top:6px;text-align:left"></div></td></tr>`;
    }).join("")||'<tr><td class="muted" style="padding:12px">no git repos found in your home</td></tr>';
    document.querySelectorAll("[data-git]").forEach(b=>b.onclick=()=>runJob(
      api("/api/gitaction",{method:"POST",
        body:JSON.stringify({path:b.dataset.p,action:b.dataset.git})})));
    document.querySelectorAll("[data-runp]").forEach(b=>b.onclick=async()=>{
      const box=b.parentElement.querySelector(".runScripts");
      if(box.style.display==="block"){box.style.display="none";return;}
      box.style.display="block";box.innerHTML='<span class="muted" style="font-size:12px">loading…</span>';
      try{
        const s=await api("/api/projectscripts?path="+encodeURIComponent(b.dataset.runp));
        box.innerHTML=s.scripts.length?s.scripts.map(x=>
          `<button class="btn small" data-rk="${esc(x.kind)}" data-rn="${esc(x.name)}"
            title="${esc(x.cmd)}">${esc(x.kind)}: ${esc(x.name)}</button>`).join(" ")
          :'<span class="muted" style="font-size:12px">no package.json / Makefile scripts found</span>';
        box.querySelectorAll("[data-rk]").forEach(sb=>sb.onclick=()=>runJob(
          api("/api/projectrun",{method:"POST",body:JSON.stringify(
            {path:b.dataset.runp,kind:sb.dataset.rk,name:sb.dataset.rn})})));
      }catch(e){box.innerHTML='<span class="muted">'+esc(e.message)+'</span>';}
    });
    document.querySelectorAll("[data-gitterm]").forEach(b=>b.onclick=()=>
      openInTerminal({cwd:b.dataset.gitterm,
        name:(b.dataset.gitterm.split("/").pop()||"repo")}));
  }catch(e){$("#gitStat").textContent="";toast(e.message,false);}
}
$("#gitReload")&&($("#gitReload").onclick=loadGit);

/* ---- API client (mini-Postman: collections, envs, flows, import) ---- */
let apiStore={collections:[],environments:{},active_env:"",history:[],flows:[]};
function curReq(){return {method:$("#hMethod2").value,url:$("#hUrl2").value,
  headers:$("#hHeaders2").value,body:$("#hBody2").value};}
function loadReq(r){$("#hMethod2").value=r.method||"GET";$("#hUrl2").value=r.url||"";
  $("#hHeaders2").value=r.headers||"";$("#hBody2").value=r.body||"";}
async function loadApiClient(){
  try{apiStore=await api("/api/httpstore");apiStore.flows=apiStore.flows||[];
    renderApiEnv();renderApiCollections();renderApiFlows();renderApiHistory();
  }catch(e){toast(e.message,false);}
}
function renderApiEnv(){
  const sel=$("#apiEnv");const names=Object.keys(apiStore.environments||{});
  sel.innerHTML='<option value="">no environment</option>'+
    names.map(n=>`<option value="${esc(n)}" ${n===apiStore.active_env?"selected":""}>${esc(n)}</option>`).join("");
  sel.onchange=()=>{apiStore.active_env=sel.value;saveApiStore();};
}
function renderApiCollections(){
  const box=$("#apiCollections");const cols=apiStore.collections||[];
  if(!cols.length){box.innerHTML='<span class="muted">no collections — Import or Save a request</span>';return;}
  box.innerHTML=cols.map((c,ci)=>`<div style="margin-bottom:8px">
    <b style="font-size:12.5px">${esc(c.name)}</b>
    <span class="hint" data-delcol="${ci}" style="color:var(--crit);cursor:pointer">✕</span>${(c.requests||[]).map((r,ri)=>`
    <div class="palItem" data-ci="${ci}" data-ri="${ri}" style="padding:3px 8px">
      <span class="mono" style="font-size:10.5px;color:var(--s1)">${esc(r.method)}</span>
      <span style="font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.name||r.url)}</span>
      <span class="hint" data-del="${ci}:${ri}" style="color:var(--crit)">✕</span></div>`).join("")}</div>`).join("");
  box.querySelectorAll("[data-ci]").forEach(el=>el.onclick=e=>{
    if(e.target.dataset.del)return;
    loadReq(apiStore.collections[+el.dataset.ci].requests[+el.dataset.ri]);});
  box.querySelectorAll("[data-del]").forEach(el=>el.onclick=e=>{
    e.stopPropagation();const[ci,ri]=el.dataset.del.split(":").map(Number);
    apiStore.collections[ci].requests.splice(ri,1);saveApiStore();renderApiCollections();});
  box.querySelectorAll("[data-delcol]").forEach(el=>el.onclick=()=>{
    if(confirm("Delete this collection?")){apiStore.collections.splice(+el.dataset.delcol,1);
      saveApiStore();renderApiCollections();}});
}
function renderApiFlows(){
  const box=$("#apiFlows");const flows=apiStore.flows||[];
  if(!flows.length){box.innerHTML='<span class="muted">no flows</span>';return;}
  box.innerHTML=flows.map((f,fi)=>`<div style="margin-bottom:8px">
    <b style="font-size:12.5px">${esc(f.name)}</b> <span class="muted">(${(f.steps||[]).length})</span>
    <div style="margin:2px 0"><button class="btn small" data-runflow="${fi}">▶ Run</button>
      <button class="btn small" data-expflow="${fi}">Export</button>
      <span class="hint" data-delflow="${fi}" style="color:var(--crit);cursor:pointer">✕</span></div>
    ${(f.steps||[]).map((s,si)=>`<div class="palItem" style="padding:2px 8px">
      <span class="mono" style="font-size:10.5px;color:var(--s1)">${esc(s.method)}</span>
      <span style="font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(s.name||s.url)}</span>
      <span class="hint" data-delstep="${fi}:${si}" style="color:var(--crit)">✕</span></div>`).join("")}</div>`).join("");
  box.querySelectorAll("[data-runflow]").forEach(b=>b.onclick=()=>runFlow(+b.dataset.runflow));
  box.querySelectorAll("[data-expflow]").forEach(b=>b.onclick=()=>exportFlow(+b.dataset.expflow));
  box.querySelectorAll("[data-delflow]").forEach(b=>b.onclick=()=>{
    apiStore.flows.splice(+b.dataset.delflow,1);saveApiStore();renderApiFlows();});
  box.querySelectorAll("[data-delstep]").forEach(b=>b.onclick=()=>{
    const[fi,si]=b.dataset.delstep.split(":").map(Number);
    apiStore.flows[fi].steps.splice(si,1);saveApiStore();renderApiFlows();});
}
function renderApiHistory(){
  const h=apiStore.history||[];
  $("#apiHistory").innerHTML=h.length?h.slice(0,12).map(e=>`
    <div class="palItem" data-hurl="${esc(e.url)}" data-hm="${esc(e.method)}" style="padding:3px 8px">
      <span class="mono" style="color:${e.status<400?"var(--goodtext)":"var(--crit)"}">${e.status}</span>
      <span class="mono" style="font-size:10.5px">${esc(e.method)}</span>
      <span style="font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(e.url)}</span>
      <span class="hint">${e.ms}ms</span></div>`).join(""):'<span class="muted">—</span>';
  $("#apiHistory").querySelectorAll("[data-hurl]").forEach(el=>el.onclick=()=>{
    $("#hUrl2").value=el.dataset.hurl;$("#hMethod2").value=el.dataset.hm;});
}
async function saveApiStore(){
  try{await api("/api/httpstore",{method:"POST",body:JSON.stringify({
    collections:apiStore.collections,environments:apiStore.environments,
    active_env:apiStore.active_env,flows:apiStore.flows})});}catch(e){toast(e.message,false);}
}
function subVars(s){
  const env=apiStore.environments[apiStore.active_env];
  if(!env||!env.vars)return s;
  return (s||"").replace(/\{\{(\w+)\}\}/g,(m,k)=>env.vars[k]!=null?env.vars[k]:m);
}
async function sendReq(req){
  return api("/api/http",{method:"POST",body:JSON.stringify({
    method:req.method,url:subVars(req.url),headers:subVars(req.headers),
    body:subVars(req.body)})});
}
$("#hSend2")&&($("#hSend2").onclick=async()=>{
  if(!$("#hUrl2").value.trim())return toast("enter a URL",false);
  $("#flowRun").style.display="none";
  $("#hResMeta2").innerHTML='<span class="muted">sending…</span>';$("#hRes2").style.display="none";
  try{
    const r=await sendReq(curReq());
    const ok=r.status<400;
    $("#hResMeta2").innerHTML=`<span class="pill" style="border-color:${ok?"var(--good)":"var(--crit)"}">${ok?"✓":"✗"} ${r.status} ${esc(r.reason||"")}</span>
      <span class="muted">${r.ms} ms · ${fmtB(r.size)}</span>
      <button class="btn small" id="hFmt2">format JSON</button>`;
    $("#hRes2").textContent=r.body||"(empty)";$("#hRes2").style.display="block";
    $("#hFmt2").onclick=()=>{try{$("#hRes2").textContent=JSON.stringify(JSON.parse(r.body),null,2);}catch(e){toast("not JSON",false);}};
    loadApiClient();
  }catch(e){$("#hResMeta2").innerHTML="";toast(e.message,false);}
});
$("#hCurl2")&&($("#hCurl2").onclick=()=>{
  const r=curReq();let c=`curl -X ${r.method} '${subVars(r.url)}'`;
  (r.headers||"").split("\n").forEach(l=>{if(l.includes(":"))c+=` \\\n  -H '${l.trim()}'`;});
  if(r.body)c+=` \\\n  -d '${r.body}'`;copyText(c);});
/* pick a collection (numbered menu; blank name = new) */
function pickCollection(){
  const cols=apiStore.collections;
  if(!cols.length){const n=prompt("New collection name:","My requests");
    if(!n)return null;cols.push({name:n,requests:[]});return cols.length-1;}
  const menu=cols.map((c,i)=>`${i+1}) ${c.name}`).join("\n");
  const a=prompt("Save to collection — type a number, or a new name:\n"+menu,"1");
  if(a==null)return null;
  if(/^\d+$/.test(a.trim())&&+a>=1&&+a<=cols.length)return +a-1;
  cols.push({name:a.trim(),requests:[]});return cols.length-1;
}
$("#apiNewCol")&&($("#apiNewCol").onclick=()=>{
  const n=prompt("New collection name:");if(!n)return;
  apiStore.collections.push({name:n,requests:[]});saveApiStore();renderApiCollections();});
$("#apiSaveReq")&&($("#apiSaveReq").onclick=()=>{
  if(!$("#hUrl2").value.trim())return toast("nothing to save",false);
  const ci=pickCollection();if(ci==null)return;
  const name=prompt("Request name:",$("#hUrl2").value.split("/").pop()||"request");
  if(!name)return;
  apiStore.collections[ci].requests.push({name,...curReq()});
  saveApiStore();renderApiCollections();toast("saved to "+apiStore.collections[ci].name);});
$("#apiNewFlow")&&($("#apiNewFlow").onclick=()=>{
  const n=prompt("New flow name:");if(!n)return;
  apiStore.flows.push({name:n,steps:[]});saveApiStore();renderApiFlows();});
$("#apiAddFlow")&&($("#apiAddFlow").onclick=()=>{
  if(!$("#hUrl2").value.trim())return toast("nothing to add",false);
  const flows=apiStore.flows;let fi;
  if(!flows.length){const n=prompt("New flow name:","Flow 1");if(!n)return;
    flows.push({name:n,steps:[]});fi=0;}
  else{const menu=flows.map((f,i)=>`${i+1}) ${f.name}`).join("\n");
    const a=prompt("Add to flow — number or new name:\n"+menu,"1");if(a==null)return;
    if(/^\d+$/.test(a.trim())&&+a>=1&&+a<=flows.length)fi=+a-1;
    else{flows.push({name:a.trim(),steps:[]});fi=flows.length-1;}}
  const name=prompt("Step name:",$("#hUrl2").value.split("/").pop()||"step");if(!name)return;
  flows[fi].steps.push({name,...curReq()});saveApiStore();renderApiFlows();
  toast("added to "+flows[fi].name);});
async function runFlow(fi){
  const f=apiStore.flows[fi];const box=$("#flowRun");box.style.display="block";
  box.innerHTML=`<b>Running flow: ${esc(f.name)}</b>`;
  let pass=0;
  for(let i=0;i<f.steps.length;i++){
    const s=f.steps[i];
    const line=document.createElement("div");line.className="mono";
    line.style.cssText="font-size:12px;padding:3px 0";
    line.innerHTML=`<span class="muted">${i+1}. ${esc(s.name||s.url)}</span> …`;
    box.appendChild(line);
    try{
      const r=await sendReq(s);
      const ok=r.status<400;if(ok)pass++;
      line.innerHTML=`<span style="color:${ok?"var(--goodtext)":"var(--crit)"}">${ok?"✓":"✗"} ${r.status}</span>
        <span class="mono" style="font-size:10.5px;color:var(--s1)">${esc(s.method)}</span>
        <span style="font-size:11.5px">${esc(s.name||s.url)}</span>
        <span class="hint">${r.ms}ms</span>`;
    }catch(e){line.innerHTML=`<span style="color:var(--crit)">✗ error</span> ${esc(s.name||s.url)} — ${esc(e.message)}`;}
  }
  const done=document.createElement("div");done.style.cssText="margin-top:6px;font-weight:600";
  done.innerHTML=`${pass}/${f.steps.length} steps passed`;
  done.style.color=pass===f.steps.length?"var(--goodtext)":"var(--serious)";
  box.appendChild(done);
}
async function exportFlow(fi){
  const f=apiStore.flows[fi];const json=JSON.stringify(f,null,2);
  let yaml="";try{yaml=(await api("/api/yaml",{method:"POST",
    body:JSON.stringify({text:JSON.stringify(f),dir:"j2y"})})).text;}catch(e){}
  $("#lbName").textContent="Flow: "+f.name;
  $("#lbBody").innerHTML=`<div class="panel" style="width:min(760px,90vw);max-height:82vh;overflow:auto;margin:0;background:var(--surface)">
    <div class="row"><button class="btn small" id="expJson">Copy JSON</button>
    ${yaml?'<button class="btn small" id="expYaml">Copy YAML</button>':""}</div>
    <pre class="mono" style="font-size:11.5px;white-space:pre-wrap">${esc(json)}</pre>
    ${yaml?`<h2>YAML</h2><pre class="mono" style="font-size:11.5px;white-space:pre-wrap">${esc(yaml)}</pre>`:""}</div>`;
  $("#lightbox").style.display="flex";
  $("#expJson").onclick=()=>copyText(json);
  if(yaml)$("#expYaml").onclick=()=>copyText(yaml);
}
/* ---- env manager (Postman-style vars editor) ---- */
$("#apiEnvEdit")&&($("#apiEnvEdit").onclick=()=>openEnvEditor($("#apiEnv").value));
function openEnvEditor(name){
  const envs=apiStore.environments;
  $("#lbName").textContent="Environments";
  const opts=Object.keys(envs).map(n=>`<option ${n===name?"selected":""}>${esc(n)}</option>`).join("");
  $("#lbBody").innerHTML=`<div class="panel" style="width:min(620px,92vw);margin:0;background:var(--surface)">
    <div class="row"><select id="envPick" class="btn"><option value="">— pick —</option>${opts}</select>
      <button class="btn small" id="envNew">＋ New</button>
      <button class="btn small danger" id="envDel">Delete</button></div>
    <div class="muted" style="font-size:12px;margin:6px 0">One <span class="mono">key=value</span> per line. Use in requests as <span class="mono">{{key}}</span>.</div>
    <textarea id="envVars" class="tin" style="height:200px"></textarea>
    <div class="row" style="margin:8px 0 0"><button class="btn" id="envSave">Save environment</button>
      <span class="muted" id="envStat" style="font-size:12px"></span></div></div>`;
  $("#lightbox").style.display="flex";
  const load=n=>{const e=envs[n];$("#envVars").value=e?Object.entries(e.vars||{}).map(([k,v])=>`${k}=${v}`).join("\n"):"";};
  if(name)load(name);
  $("#envPick").onchange=()=>load($("#envPick").value);
  $("#envNew").onclick=()=>{const n=prompt("Environment name:");if(!n)return;
    envs[n]={vars:{}};openEnvEditor(n);};
  $("#envDel").onclick=()=>{const n=$("#envPick").value;if(!n)return;
    if(confirm("Delete environment "+n+"?")){delete envs[n];
      if(apiStore.active_env===n)apiStore.active_env="";saveApiStore();renderApiEnv();$("#lbClose").click();}};
  $("#envSave").onclick=()=>{const n=$("#envPick").value;if(!n)return toast("pick or create an env",false);
    const vars={};$("#envVars").value.split("\n").forEach(l=>{const i=l.indexOf("=");
      if(i>0)vars[l.slice(0,i).trim()]=l.slice(i+1).trim();});
    envs[n]={vars};apiStore.active_env=n;saveApiStore();renderApiEnv();
    $("#envStat").textContent="saved ✓";toast("environment saved");};
}
/* ---- import: Postman JSON / curl / raw HTTP / Perch flow ---- */
$("#apiImport")&&($("#apiImport").onclick=()=>{
  const b=$("#apiImportBox");b.style.display=b.style.display==="none"?"block":"none";});
function parseCurl(txt){
  const toks=txt.match(/'[^']*'|"[^"]*"|\S+/g)||[];
  let method="GET",url="",headers=[],body="";
  const unq=s=>s.replace(/^['"]|['"]$/g,"");
  for(let i=0;i<toks.length;i++){
    const t=toks[i];
    if(t==="curl")continue;
    if(t==="-X"||t==="--request")method=unq(toks[++i]||"GET");
    else if(t==="-H"||t==="--header")headers.push(unq(toks[++i]||""));
    else if(t==="-d"||t==="--data"||t==="--data-raw"||t==="--data-binary"){body=unq(toks[++i]||"");if(method==="GET")method="POST";}
    else if(t==="-b"||t==="--cookie"||t==="-u"||t==="--user")headers.push((t.includes("cookie")?"Cookie: ":"Authorization: ")+unq(toks[++i]||""));
    else if(t.startsWith("http"))url=unq(t);
    else if(!t.startsWith("-")&&!url)url=unq(t);
  }
  return {method,url,headers:headers.join("\n"),body};
}
function parseRawHttp(txt){
  const lines=txt.split(/\r?\n/);const m=(lines[0]||"").match(/^([A-Z]+)\s+(\S+)\s+HTTP/i);
  if(!m)return null;
  let method=m[1],path=m[2],headers=[],host="",i=1;
  for(;i<lines.length&&lines[i].trim();i++){
    const idx=lines[i].indexOf(":");if(idx<0)continue;
    const k=lines[i].slice(0,idx).trim(),v=lines[i].slice(idx+1).trim();
    if(k.toLowerCase()==="host")host=v;else headers.push(`${k}: ${v}`);}
  const body=lines.slice(i+1).join("\n");
  const url=/^https?:\/\//i.test(path)?path:("http://"+host+path);
  return {method,url,headers:headers.join("\n"),body};
}
function postmanReq(item,prefix){
  const rq=item.request;if(!rq)return null;
  const url=typeof rq.url==="string"?rq.url:(rq.url&&(rq.url.raw||(rq.url.host||[]).join(".")+"/"+((rq.url.path||[]).join("/"))))||"";
  const headers=(rq.header||[]).filter(h=>!h.disabled).map(h=>`${h.key}: ${h.value}`).join("\n");
  return {name:(prefix?prefix+" / ":"")+(item.name||url),method:(rq.method||"GET"),
    url,headers,body:(rq.body&&rq.body.raw)||""};
}
function flattenPostman(items,prefix,out){
  for(const it of items||[]){
    if(it.item)flattenPostman(it.item,(prefix?prefix+" / ":"")+(it.name||""),out);
    else{const r=postmanReq(it,prefix);if(r)out.push(r);}}
  return out;
}
$("#apiImportGo")&&($("#apiImportGo").onclick=()=>{
  const txt=$("#apiImportText").value.trim();if(!txt)return;
  try{
    if(/^curl\b/.test(txt)){loadReq(parseCurl(txt));toast("curl imported into the builder");}
    else if(/^[A-Z]+\s+\S+\s+HTTP/i.test(txt)){const r=parseRawHttp(txt);
      if(!r)throw new Error("could not parse HTTP request");loadReq(r);toast("HTTP request imported");}
    else{
      const j=JSON.parse(txt);
      if(j.info&&j.item){const reqs=flattenPostman(j.item,"",[]);
        apiStore.collections.push({name:j.info.name||"Imported",requests:reqs});
        saveApiStore();renderApiCollections();toast(`imported ${reqs.length} requests`);}
      else if(j.values&&j.name){const vars={};
        (j.values||[]).filter(v=>v.enabled!==false).forEach(v=>vars[v.key]=v.value);
        apiStore.environments[j.name]={vars};apiStore.active_env=j.name;
        saveApiStore();renderApiEnv();toast("environment imported: "+j.name);}
      else if(j.steps&&j.name){apiStore.flows.push(j);saveApiStore();renderApiFlows();toast("flow imported: "+j.name);}
      else if(j.requests){apiStore.collections.push({name:j.name||"Imported",requests:j.requests});
        saveApiStore();renderApiCollections();toast("collection imported");}
      else throw new Error("unrecognized JSON — expected Postman collection/env, or a Perch flow");
    }
    $("#apiImportText").value="";$("#apiImportBox").style.display="none";
  }catch(e){toast("import failed: "+e.message,false);}
});

/* ---- kernel ---- */
function copyText(t){navigator.clipboard.writeText(t).then(()=>toast("command copied"),
  ()=>toast("copy failed — select it manually",false));}
async function loadKernel(){
  try{
    const k=await api("/api/kernel");
    $("#kver").textContent=k.version;
    $("#kcmd").textContent=k.cmdline;
    const govs=[...new Set(k.governors.map(g=>g.governor))];
    $("#kgov").innerHTML=(govs.length===1
      ?`<span class="pill">all ${k.governors.length} cores: <b>${esc(govs[0])}</b></span>
        <span class="muted" style="font-size:12px"> available: ${(k.governors[0]?.available||[]).map(esc).join(", ")}</span>`
      :k.governors.map(g=>`<span class="pill" style="margin:2px"><b>${esc(g.policy)}</b> ${esc(g.governor)}</span>`).join(""))+
      `<div class="row" style="margin-top:10px">
        <span class="muted" style="font-size:12.5px">switch all cores:</span>
        ${(k.governors[0]?.available||[]).map(g=>`<button class="btn small" data-gov="${esc(g)}">${esc(g)}</button>`).join("")}
      </div>`;
    $("#kgov").querySelectorAll("[data-gov]").forEach(b=>b.onclick=()=>copyText(
      `echo ${b.dataset.gov} | sudo tee /sys/devices/system/cpu/cpufreq/policy*/scaling_governor`));
    $("#ktun tbody").innerHTML=k.tunables.map((t,i)=>`
      <tr><td style="width:26%"><span class="mono" style="font-size:12px"><b>${esc(t.key)}</b></span><br>
        <span class="muted" style="font-size:11.5px">${esc(t.desc)}</span></td>
      <td class="num mono" style="width:130px;font-size:12.5px">${esc(t.value)}</td>
      <td style="width:230px;white-space:nowrap">
        <input type="text" id="tun${i}" value="${esc(t.value)}" style="min-width:90px;width:110px;font-size:12px;padding:4px 8px">
        <button class="btn small" data-tunkey="${esc(t.key)}" data-tuni="${i}">Copy cmd</button></td></tr>`).join("")+
      (k.thp?`<tr><td><span class="mono" style="font-size:12px"><b>transparent_hugepage</b></span><br>
        <span class="muted" style="font-size:11.5px">THP mode — [brackets] mark the active one.</span></td>
        <td class="num mono" style="font-size:12.5px">${esc(k.thp)}</td><td></td></tr>`:"");
    $("#ktun").querySelectorAll("[data-tunkey]").forEach(b=>b.onclick=()=>{
      const v=document.getElementById("tun"+b.dataset.tuni).value.trim();
      copyText(`sudo sysctl -w ${b.dataset.tunkey}="${v}"`);});
    $("#kmodn").textContent=`· ${k.nmodules} loaded`;
    $("#kmods tbody").innerHTML=k.modules.map(m=>`
      <tr><td class="mono" style="font-size:12px">${esc(m.name)}</td>
      <td class="num" style="width:90px">${fmtB(m.size)}</td>
      <td class="muted mono" style="font-size:11px;max-width:420px;overflow:hidden;
        text-overflow:ellipsis;white-space:nowrap">${esc(m.used_by)}</td></tr>`).join("");
  }catch(e){toast(e.message,false);}
}

/* ---- drawer: note + sketch ---- */
const drawer=$("#drawer");let dMode="note",dFolder=HOME_DIR,dPath=null;
function openDrawer(mode,folder,path,content){
  dMode=mode;dFolder=folder;dPath=path||null;
  $("#dFolder").value=folder;
  $("#modeNote").classList.toggle("on",mode==="note");
  $("#modeSketch").classList.toggle("on",mode==="sketch");
  $("#dText").style.display=mode==="note"?"":"none";
  $("#dCanvas").style.display=mode==="sketch"?"":"none";
  $("#sketchTools").style.display=mode==="sketch"?"":"none";
  $("#dStatus").textContent="";
  if(mode==="note"){
    $("#dText").value=content??"";
    $("#dName").value=path?path.split("/").pop():"note-"+new Date().toISOString().slice(0,10)+".md";
    vimMode=vimOn?"normal":"insert";vimPend=vimCount="";vimCmd=null;
    vimUndo=[];vimRedo=[];vimStat();
  }else{
    $("#dName").value="sketch-"+new Date().toISOString().slice(0,16).replace(/[T:]/g,"-")+".png";
    setTimeout(initCanvas,240);
  }
  drawer.classList.add("open");
  if(mode==="note")setTimeout(()=>$("#dText").focus(),240);
}
$("#dClose").onclick=()=>drawer.classList.remove("open");
$("#modeNote").onclick=()=>openDrawer("note",dFolder);
$("#modeSketch").onclick=()=>openDrawer("sketch",dFolder);
$("#dSave").onclick=async()=>{
  const name=$("#dName").value.trim();
  if(!name)return toast("give it a filename",false);
  const folder=($("#dFolder").value.trim()||dFolder).replace(/\/$/,"");
  const target=dPath&&dPath.split("/").pop()===name&&folder===dPath.slice(0,dPath.lastIndexOf("/"))
    ?dPath:folder+"/"+name;
  try{
    if(dMode==="note"){
      const r=await api("/api/writefile",{method:"POST",
        body:JSON.stringify({path:target,content:$("#dText").value})});
      dPath=r.path;$("#dStatus").textContent="saved "+new Date().toLocaleTimeString();
      toast("saved "+r.path);
    }else{
      const data=$("#dCanvas").toDataURL("image/png");
      const r=await api("/api/savepng",{method:"POST",
        body:JSON.stringify({path:target,data})});
      $("#dStatus").textContent="saved "+new Date().toLocaleTimeString();
      toast("saved "+r.path);
    }
    if($("#tab-files").classList.contains("on"))loadFiles(fPath);
  }catch(e){toast(e.message,false);}
};
/* ---- vim mode ---- */
let vimOn=localStorage.vim==="1",vimMode="insert",vimPend="",vimCount="",
    vimCmd=null,vimReg={text:"",line:false},vimUndo=[],vimRedo=[];
const ta=$("#dText");
function vimStat(){
  $("#vimTog").textContent="vim: "+(vimOn?"on":"off");
  $("#vimStat").textContent=!vimOn?"":
    vimCmd!==null?":"+vimCmd:
    (vimMode==="normal"?"-- NORMAL --":"-- INSERT --")+" "+vimCount+vimPend;
}
$("#vimTog").onclick=()=>{vimOn=!vimOn;localStorage.vim=vimOn?"1":"0";
  vimMode=vimOn?"normal":"insert";vimPend=vimCount="";vimCmd=null;vimStat();ta.focus();};
function vSnap(){vimUndo.push({v:ta.value,s:ta.selectionStart});
  if(vimUndo.length>200)vimUndo.shift();vimRedo=[];}
function vSet(v,s){ta.value=v;ta.selectionStart=ta.selectionEnd=Math.max(0,Math.min(s,v.length));}
function lineB(v,p){const a=v.lastIndexOf("\n",p-1)+1;
  let b=v.indexOf("\n",p);if(b<0)b=v.length;return[a,b];}
function vMotion(key,cnt){
  let p=ta.selectionStart;const v=ta.value;
  for(let i=0;i<cnt;i++){
    if(key==="h")p=Math.max(lineB(v,p)[0],p-1);
    else if(key==="l")p=Math.min(lineB(v,p)[1],p+1);
    else if(key==="0")p=lineB(v,p)[0];
    else if(key==="$")p=lineB(v,p)[1];
    else if(key==="^"){const[a,b]=lineB(v,p);const m=v.slice(a,b).match(/\S/);p=a+(m?m.index:0);}
    else if(key==="j"||key==="k"){
      const[a]=lineB(v,p),col=p-a;
      if(key==="j"){const[,b]=lineB(v,p);if(b>=v.length)break;
        const[na,nb]=lineB(v,b+1);p=Math.min(na+col,nb);}
      else{if(a===0)break;const[pa,pb]=lineB(v,a-1);p=Math.min(pa+col,pb);}}
    else if(key==="w"){const m=v.slice(p).match(/^(?:\w+|[^\w\s]+)?\s*/);
      p=m&&m[0].length?p+m[0].length:v.length;}
    else if(key==="b"){const before=v.slice(0,p);
      const m=before.match(/(\w+|[^\w\s]+)\s*$/);p=m?before.lastIndexOf(m[1]):0;}
    else if(key==="e"){const m=v.slice(p+1).match(/(\w+|[^\w\s]+)/);
      p=m?p+1+m.index+m[0].length-1:v.length;}
    else if(key==="G")p=v.length;
    else if(key==="g")p=0;
  }
  return p;
}
function vDelRange(a,b,line){
  vSnap();const v=ta.value;
  vimReg={text:v.slice(a,b),line};
  vSet(v.slice(0,a)+v.slice(b),a);
}
function vExecCmd(c){
  c=c.trim();
  if(c==="w"||c==="wq")$("#dSave").click();
  if(c==="q"||c==="wq")drawer.classList.remove("open");
  if(/^\d+$/.test(c)){const lines=ta.value.split("\n");
    const n=Math.min(+c,lines.length);
    vSet(ta.value,lines.slice(0,n-1).join("\n").length+(n>1?1:0));}
}
function handleVim(e){
  if(e.ctrlKey&&e.key==="r"&&vimMode==="normal"){
    e.preventDefault();
    if(vimRedo.length){vimUndo.push({v:ta.value,s:ta.selectionStart});
      const r=vimRedo.pop();vSet(r.v,r.s);}
    return true;}
  if(e.ctrlKey||e.metaKey||e.altKey)return false;
  const k=e.key;
  if(vimMode==="insert"){
    if(k==="Escape"){e.preventDefault();vimMode="normal";
      const[a]=lineB(ta.value,ta.selectionStart);
      if(ta.selectionStart>a)vSet(ta.value,ta.selectionStart-1);
      vimPend=vimCount="";vimStat();return true;}
    return false;
  }
  e.preventDefault();
  if(vimCmd!==null){
    if(k==="Enter"){const c=vimCmd;vimCmd=null;vExecCmd(c);}
    else if(k==="Escape")vimCmd=null;
    else if(k==="Backspace")vimCmd=vimCmd.slice(0,-1);
    else if(k.length===1)vimCmd+=k;
    vimStat();return true;
  }
  if(k==="Escape"){vimPend=vimCount="";vimStat();return true;}
  if(k.length!==1&&!["Backspace"].includes(k))return true;
  if(/[1-9]/.test(k)||(k==="0"&&vimCount)){vimCount+=k;vimStat();return true;}
  const cnt=Math.max(1,parseInt(vimCount||"1",10));
  const v=ta.value,p=ta.selectionStart;
  const enterInsert=(np)=>{vSnap();vimMode="insert";
    if(np!=null)vSet(ta.value,np);vimPend=vimCount="";vimStat();};
  if(vimPend==="g"){vimPend="";
    if(k==="g")vSet(v,0);
    vimCount="";vimStat();return true;}
  if(vimPend==="d"||vimPend==="y"||vimPend==="c"){
    const op=vimPend;vimPend="";
    if(k===op||((k==="d"||k==="y"||k==="c")&&k===op)){ // dd yy cc
      let[a,b]=lineB(v,p);
      for(let i=1;i<cnt;i++){if(b<v.length){const[,nb]=lineB(v,b+1);b=nb;}}
      const end=b<v.length?b+1:b;
      if(op==="y"){vimReg={text:v.slice(a,end),line:true};}
      else{vDelRange(a,end,true);if(op==="c")enterInsert(null);}
    }else if("hlwbe0$^Gg".includes(k)){
      const np=vMotion(k,cnt);
      const[a,b]=np>p?[p,np]:[np,p];
      if(op==="y"){vimReg={text:v.slice(a,b),line:false};}
      else{vDelRange(a,b,false);if(op==="c")enterInsert(null);}
    }
    vimCount="";vimStat();return true;
  }
  switch(k){
    case"i":enterInsert(null);break;
    case"a":enterInsert(Math.min(lineB(v,p)[1],p+1));break;
    case"I":enterInsert(vMotion("^",1));break;
    case"A":enterInsert(lineB(v,p)[1]);break;
    case"o":{vSnap();const[,b]=lineB(v,p);vimMode="insert";
      vSet(v.slice(0,b)+"\n"+v.slice(b),b+1);break;}
    case"O":{vSnap();const[a]=lineB(v,p);vimMode="insert";
      vSet(v.slice(0,a)+"\n"+v.slice(a),a);break;}
    case"x":{const[,b]=lineB(v,p);
      if(p<b)vDelRange(p,Math.min(b,p+cnt),false);break;}
    case"D":vDelRange(p,lineB(v,p)[1],false);break;
    case"C":vDelRange(p,lineB(v,p)[1],false);enterInsert(null);break;
    case"d":case"y":case"c":case"g":vimPend=k;break;
    case"p":case"P":{vSnap();
      if(vimReg.line){const[a,b]=lineB(v,p);
        const at=k==="p"?(b<v.length?b+1:b):a;
        let txt=vimReg.text.endsWith("\n")?vimReg.text:vimReg.text+"\n";
        if(k==="p"&&b>=v.length&&v.length&&!v.endsWith("\n"))txt="\n"+vimReg.text;
        vSet(v.slice(0,at)+txt+v.slice(at),at);}
      else{const at=k==="p"?Math.min(lineB(v,p)[1],p+1):p;
        vSet(v.slice(0,at)+vimReg.text+v.slice(at),at+vimReg.text.length-1);}
      break;}
    case"u":{if(vimUndo.length){vimRedo.push({v:ta.value,s:ta.selectionStart});
      const r=vimUndo.pop();vSet(r.v,r.s);}break;}
    case"G":vSet(v,lineB(v,v.length)[0]);break;
    case":":vimCmd="";break;
    default:
      if("hjklwbe0$^".includes(k))vSet(v,vMotion(k,cnt));
  }
  vimCount="";vimStat();return true;
}
ta.onkeydown=e=>{
  if((e.ctrlKey||e.metaKey)&&e.key==="s"){e.preventDefault();$("#dSave").click();return;}
  if(vimOn&&handleVim(e))return;
  if(e.key==="Tab"){e.preventDefault();
    const t=e.target,s=t.selectionStart;
    t.value=t.value.slice(0,s)+"    "+t.value.slice(t.selectionEnd);
    t.selectionStart=t.selectionEnd=s+4;}
};
/* canvas */
let drawing=false,erasing=false,cvsInit=false;
function initCanvas(){
  const c=$("#dCanvas");
  const r=c.getBoundingClientRect();
  if(c.width!==Math.round(r.width)){
    const old=cvsInit?c.toDataURL():null;
    c.width=Math.round(r.width);c.height=Math.round(r.height);
    const x=c.getContext("2d");x.fillStyle="#ffffff";x.fillRect(0,0,c.width,c.height);
    if(old){const im=new Image();im.onload=()=>x.drawImage(im,0,0);im.src=old;}
    cvsInit=true;
  }
}
function cpos(e){const r=$("#dCanvas").getBoundingClientRect();
  const p=e.touches?e.touches[0]:e;
  return[p.clientX-r.left,p.clientY-r.top];}
function strokeStart(e){drawing=true;const[x,y]=cpos(e);
  const ctx=$("#dCanvas").getContext("2d");
  ctx.beginPath();ctx.moveTo(x,y);e.preventDefault();}
function strokeMove(e){
  if(!drawing)return;
  const ctx=$("#dCanvas").getContext("2d");
  const[x,y]=cpos(e);
  ctx.lineTo(x,y);
  ctx.strokeStyle=erasing?"#ffffff":$("#penColor").value;
  ctx.lineWidth=erasing?+$("#penSize").value*4:+$("#penSize").value;
  ctx.lineCap="round";ctx.lineJoin="round";ctx.stroke();e.preventDefault();
}
const cv=$("#dCanvas");
cv.onmousedown=strokeStart;cv.onmousemove=strokeMove;
cv.onmouseup=cv.onmouseleave=()=>drawing=false;
cv.addEventListener("touchstart",strokeStart,{passive:false});
cv.addEventListener("touchmove",strokeMove,{passive:false});
cv.addEventListener("touchend",()=>drawing=false);
$("#penErase").onclick=()=>{erasing=!erasing;
  $("#penErase").style.fontWeight=erasing?"700":"400";};
$("#penClear").onclick=()=>{const x=cv.getContext("2d");
  x.fillStyle="#fff";x.fillRect(0,0,cv.width,cv.height);};
$("#newFile").onclick=()=>openDrawer("note",fPath);
$("#newSketch").onclick=()=>openDrawer("sketch",fPath);
async function editInDrawer(path){
  try{
    const r=await api("/api/readfile?path="+encodeURIComponent(path));
    openDrawer("note",path.slice(0,path.lastIndexOf("/"))||"/",r.path,r.content);
    if(!r.writable)$("#dStatus").textContent="⚠ read-only for your user — Save will fail";
  }catch(e){toast(e.message,false);}
}

/* ---- cleanup ---- */
/* ---- weekly auto tidy-up ---- */
async function loadMaint(){
  try{
    const m=await api("/api/maintenance");
    $("#maintTog").textContent=m.enabled?"🟢 On":"⚪ Off";
    $("#maintNext").textContent=m.enabled&&m.next?`next: ${m.next}`:"";
    $("#maintTog").onclick=async()=>{
      try{await api("/api/maintenance",{method:"POST",
        body:JSON.stringify({enabled:!m.enabled})});
        toast(m.enabled?"auto tidy-up off":"auto tidy-up on — weekly");
        loadMaint();}catch(e){toast(e.message,false);}};
  }catch(e){}
}
async function loadClean(){
  loadMaint();
  $("#cleanTargets").textContent="scanning sizes…";
  try{
    const c=await api("/api/cleanup");
    $("#cleanTargets").innerHTML=`<table><tbody>`+c.targets.map(t=>`
      <tr><td style="width:26%"><b>${esc(t.label)}</b><br>
        <span class="muted" style="font-size:12px">${esc(t.desc)}</span></td>
      <td class="mono muted" style="font-size:11.5px">${esc(t.path||"")}</td>
      <td class="num" style="width:90px"><b>${fmtB(t.size)}</b></td>
      <td class="num" style="width:90px">${t.size>0?`<button class="btn small danger" data-clean="${t.id}">Clean</button>`:`<span class="muted">clean ✓</span>`}</td>
      </tr>`).join("")+`</tbody></table>`;
    const maxc=Math.max(1,...c.cache_top.map(x=>x.size));
    $("#cacheTop tbody").innerHTML=c.cache_top.map(x=>`
      <tr><td style="width:30%" class="mono">${esc(x.name)}</td>
      <td class="num" style="width:100px">${fmtB(x.size)}</td>
      <td><div class="bar"><i style="width:${(x.size/maxc*100).toFixed(1)}%"></i></div></td>
      <td class="num" style="width:90px"><button class="btn small danger" data-cachedir="${esc(x.path)}">Delete</button></td></tr>`).join("");
    $("#sudoList").innerHTML=c.sudo.length?c.sudo.map(s=>`
      <div style="margin:8px 0"><b style="color:var(--ink)">${esc(s.label)}</b>
      — ${esc(s.info)}<br><code>${esc(s.cmd)}</code></div>`).join("")
      :"nothing significant found";
    document.querySelectorAll("[data-clean]").forEach(b=>b.onclick=async()=>{
      if(!confirm("Clean this now?"))return;
      try{const r=await api("/api/clean",{method:"POST",
        body:JSON.stringify({target:b.dataset.clean})});
        toast(`freed ${fmtB(r.freed)}`);loadClean();}
      catch(e){toast(e.message,false);}
    });
    document.querySelectorAll("[data-cachedir]").forEach(b=>b.onclick=async()=>{
      if(!confirm(`Delete cache folder?\n${b.dataset.cachedir}`))return;
      try{const r=await api("/api/clean",{method:"POST",
        body:JSON.stringify({target:"cachedir",path:b.dataset.cachedir})});
        toast(`freed ${fmtB(r.freed)}`);loadClean();}
      catch(e){toast(e.message,false);}
    });
  }catch(e){$("#cleanTargets").textContent="";toast(e.message,false);}
}
