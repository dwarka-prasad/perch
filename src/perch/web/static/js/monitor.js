/* Perch — monitor, custom rules, security, fleet, shortcuts, history, digest, alerting.
   Part of the frontend, split positionally from one file: the
   scripts are loaded in order and share one global scope, so
   execution order is exactly as it was. */
/* ---- monitor ---- */
const MON_LABELS={cpu:"CPU above % (sustained 60 s)",mem:"Memory above %",
  temp:"Temperature above °C",disk:"Any disk above % full",
  battery:"Battery below % (unplugged)"};
async function loadMonitor(){
  try{
    const m=await api("/api/monitor?brief=1");
    if(m.ctl)renderAlertCtl(m.ctl);
    crRules=m.custom||[];crKinds=m.custom_kinds||{};renderCustom();
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
    loadTrend();loadDigest();
    loadChannels();loadLogwatch();
  }catch(e){toast(e.message,false);}
}
/* ---- custom alert rules (unit / port / process / folder size) ---- */
let crRules=[],crKinds={};
function renderCustom(){
  const kinds=Object.keys(crKinds).length?crKinds:{unit:"unit",port:"port",
    process:"process",path:"folder size"};
  const ph={unit:"name.service",port:"8080",process:"postgres",
    path:"~/Downloads"};
  $("#crRules").innerHTML=crRules.map((r,i)=>`
    <div class="row" style="margin-bottom:6px">
      <input type="text" class="crName" data-i="${i}" value="${esc(r.name||"")}"
        placeholder="rule name" style="width:150px">
      <select class="btn crKind" data-i="${i}">${Object.entries(kinds).map(([k,label])=>
        `<option value="${k}" ${k===r.kind?"selected":""}>${esc(label)}</option>`).join("")}</select>
      <input type="text" class="crTarget mono" data-i="${i}" value="${esc(r.target||"")}"
        placeholder="${ph[r.kind]||""}" style="flex:1;min-width:150px">
      <input type="text" class="crValue" data-i="${i}" value="${r.value||0}"
        style="width:70px;min-width:70px" title="threshold (GB, folder rules only)"
        ${r.kind==="path"?"":"disabled"}>
      <label class="pill"><input type="checkbox" class="crEn" data-i="${i}"
        ${r.enabled!==false?"checked":""}> on</label>
      <button class="btn small" data-crtest="${i}" title="evaluate this rule right now">Test</button>
      <span class="hint" data-crdel="${i}" style="color:var(--crit);cursor:pointer">✕</span>
    </div>`).join("")||'<span class="muted" style="font-size:12px">no custom rules yet</span>';
  $("#crRules").querySelectorAll("[data-crdel]").forEach(el=>el.onclick=()=>{
    collectCustom();crRules.splice(+el.dataset.crdel,1);renderCustom();});
  // evaluate one rule immediately, so you learn whether it works without
  // saving it and waiting out the once-a-minute cycle
  $("#crRules").querySelectorAll("[data-crtest]").forEach(b=>b.onclick=async()=>{
    collectCustom();
    const rule=crRules[+b.dataset.crtest];
    b.disabled=true;$("#crStat").textContent="testing…";
    try{const r=await api("/api/customtest",{method:"POST",
      body:JSON.stringify({rule})});
      $("#crStat").innerHTML=r.breached
        ?`<b style="color:var(--serious)">would alert:</b> ${esc(r.message)}`
        :`<span style="color:var(--goodtext)">${esc(r.message)}</span>`;}
    catch(e){$("#crStat").textContent="";toast(e.message,false);}
    b.disabled=false;});
  // the threshold box only means anything for folder-size rules
  $("#crRules").querySelectorAll(".crKind").forEach(s=>s.onchange=()=>{
    collectCustom();renderCustom();});
}
function collectCustom(){
  const g=c=>[...document.querySelectorAll(c)];
  crRules=g(".crName").map((n,i)=>({
    name:n.value.trim(),
    kind:g(".crKind")[i].value,
    target:g(".crTarget")[i].value.trim(),
    value:parseFloat(g(".crValue")[i].value)||0,
    enabled:g(".crEn")[i].checked}));
}
$("#crAdd")&&($("#crAdd").onclick=()=>{collectCustom();
  crRules.push({name:"",kind:"unit",target:"",value:0,enabled:true});renderCustom();});
$("#crSave")&&($("#crSave").onclick=async()=>{
  collectCustom();
  try{const r=await api("/api/customrules",{method:"POST",
    body:JSON.stringify({rules:crRules.filter(x=>x.target)})});
    crRules=r.rules;renderCustom();
    $("#crStat").textContent=`saved ${r.rules.length} rule(s) ✓`;
    toast("custom rules saved");}
  catch(e){$("#crStat").textContent="";toast(e.message,false);}});

/* ---- security overview ---- */
const SEV_ICON={crit:"🔴",warn:"🟠",info:"🔵"};
async function loadSecurity(){
  const body=$("#secFindings");if(!body)return;
  body.textContent="checking…";
  try{
    const s=await api("/api/security");
    const color=s.score>=90?"var(--goodtext)":s.score>=70?"var(--s1)"
      :s.score>=50?"var(--serious)":"var(--crit)";
    $("#secScore").innerHTML=`— <b style="color:${color}">${s.score}/100</b>`;
    const goTo={"Firewall is off":"net","No firewall installed":"net"};
    body.innerHTML=s.findings.length?s.findings.map(f=>`
      <div class="finding"><span class="fi">${SEV_ICON[f.sev]||"ℹ️"}</span>
        <div style="flex:1"><div class="ft">${esc(f.title)}</div>
        <div class="fd">${esc(f.detail)}</div></div>
        ${/port|Firewall|firewall/.test(f.title)?'<button class="btn small" data-sectab="net">Network</button>':""}
        ${/security update/.test(f.title)?'<button class="btn small" data-sectab="updates">Updates</button>':""}
        ${/SSH|Permit|Password/i.test(f.title)?'<button class="btn small" data-sectab="term">Terminal</button>':""}
      </div>`).join("")
      :'<span style="color:var(--goodtext)">nothing looks exposed 🎉</span>';
    body.querySelectorAll("[data-sectab]").forEach(b=>
      b.onclick=()=>goTab(b.dataset.sectab));
    $("#secPorts").innerHTML=s.public_ports.length?
      '<table><thead><tr><th class="num">Port</th><th>Bind</th><th>Process</th></tr></thead><tbody>'+
      s.public_ports.map(p=>`<tr><td class="num"><b>${p.port}</b></td>
        <td class="mono">${esc(p.addr)}</td>
        <td>${esc(p.name||"—")}</td></tr>`).join("")+'</tbody></table>'
      :'<span style="color:var(--goodtext)">no ports accept connections from the network</span>';
    const fl=s.failed_logins;
    $("#secLoginMeta").textContent=fl.readable
      ?`— ${fl.total} in the last ${fl.days} days`:"— journal not readable";
    $("#secLogins").innerHTML=!fl.readable
      ?'<span class="muted">reading the system journal needs to be in the '+
       '<span class="mono">adm</span> or <span class="mono">systemd-journal</span> group</span>'
      :(fl.top.length?'<table><tbody>'+fl.top.map(t=>
        `<tr><td class="mono">${esc(t.source)}</td>
         <td class="num">${t.count}</td></tr>`).join("")+'</tbody></table>'
        :'<span style="color:var(--goodtext)">no failed logins 🎉</span>');
    $("#secAdmins").innerHTML=
      (s.admins.length?s.admins.map(g=>
        `<div style="padding:3px 0"><b>${esc(g.group)}</b>: `+
        g.members.map(m=>`<span class="pill">${esc(m)}</span>`).join(" ")+'</div>').join("")
        :'<span class="muted">no admin groups found</span>')+
      `<div style="margin-top:8px">Automatic security updates: ${
        s.auto_updates===true?'<b style="color:var(--goodtext)">on</b>'
        :s.auto_updates===false?'<b style="color:var(--serious)">off</b>'
        :'<span class="muted">not applicable</span>'}</div>`;
  }catch(e){body.innerHTML=`<span class="muted">${esc(e.message)}</span>`;}
}
$("#secReload")&&($("#secReload").onclick=loadSecurity);

/* ---- fleet: other Perch instances, read-only ---- */
let fleetHosts=[];
async function loadFleet(){
  try{
    fleetHosts=(await api("/api/fleetconfig")).hosts;renderFleetHosts();
  }catch(e){}
  const body=$("#fleetBody");if(!body)return;
  if(!fleetHosts.length){
    $("#fleetMeta").textContent="";
    body.innerHTML='<span class="muted">no other machines configured yet — '+
      'add one below</span>';return;}
  body.textContent="polling…";
  try{
    const f=await api("/api/fleet");
    $("#fleetMeta").textContent=`— ${f.reachable}/${f.configured} reachable`;
    body.innerHTML='<table><thead><tr><th>Machine</th><th class="num">CPU</th>'+
      '<th class="num">Memory</th><th class="num">Temp</th><th class="num">Uptime</th>'+
      '<th>Status</th></tr></thead><tbody>'+
      f.hosts.map(h=>`<tr>
        <td><b>${esc(h.name)}</b>
          <div class="mono muted" style="font-size:10.5px">${esc(h.hostname||h.url)}</div></td>
        <td class="num">${h.ok&&h.cpu!=null?h.cpu.toFixed(0)+"%":"—"}</td>
        <td class="num">${h.ok&&h.mem!=null?h.mem.toFixed(0)+"%":"—"}</td>
        <td class="num">${h.ok&&h.temp?h.temp.toFixed(0)+"°":"—"}</td>
        <td class="num">${h.ok&&h.uptime?fmtDur(h.uptime):"—"}</td>
        <td>${h.ok?'🟢 up':'<span style="color:var(--crit)">🔴 '+esc(h.error||"unreachable")+'</span>'}</td>
      </tr>`).join("")+'</tbody></table>';
  }catch(e){body.innerHTML=`<span class="muted">${esc(e.message)}</span>`;}
}
function renderFleetHosts(){
  $("#fleetHosts").innerHTML=fleetHosts.map((h,i)=>`
    <div class="row" style="margin-bottom:6px">
      <input type="text" class="flName" data-i="${i}" value="${esc(h.name||"")}"
        placeholder="name" style="width:140px">
      <input type="text" class="flUrl mono" data-i="${i}" value="${esc(h.url||"")}"
        placeholder="http://10.0.0.5:9080" style="flex:1;min-width:180px">
      <input type="password" class="flTok mono" data-i="${i}" value=""
        placeholder="${h.has_token?"token saved — blank keeps it":"token"}"
        style="width:170px">
      <span class="hint" data-fldel="${i}" style="color:var(--crit);cursor:pointer">✕</span>
    </div>`).join("")||'<span class="muted" style="font-size:12px">no hosts</span>';
  $("#fleetHosts").querySelectorAll("[data-fldel]").forEach(el=>el.onclick=()=>{
    collectFleet();fleetHosts.splice(+el.dataset.fldel,1);renderFleetHosts();});
}
function collectFleet(){
  const g=c=>[...document.querySelectorAll(c)];
  fleetHosts=g(".flName").map((n,i)=>({name:n.value.trim(),
    url:g(".flUrl")[i].value.trim(),token:g(".flTok")[i].value.trim(),
    has_token:fleetHosts[i]&&fleetHosts[i].has_token}));
}
$("#fleetAdd")&&($("#fleetAdd").onclick=()=>{collectFleet();
  fleetHosts.push({name:"",url:"",token:""});renderFleetHosts();});
$("#fleetSave")&&($("#fleetSave").onclick=async()=>{
  collectFleet();
  try{const r=await api("/api/fleetconfig",{method:"POST",
    body:JSON.stringify({hosts:fleetHosts.filter(h=>h.url)})});
    fleetHosts=r.hosts;renderFleetHosts();
    $("#fleetStat").textContent=`saved ${r.hosts.length} host(s) ✓`;
    loadFleet();}
  catch(e){$("#fleetStat").textContent="";toast(e.message,false);}});
$("#fleetReload")&&($("#fleetReload").onclick=loadFleet);

/* ---- keyboard shortcut sheet ---- */
const KEY_HELP=[
  ["Anywhere",[["Ctrl+K","Command palette — jump to a tab, run an action, find a file"],
    ["Ctrl+I","Open or close the assistant"],
    ["?","This list"],["Esc","Close whatever is open"]]],
  ["Terminal",[["Ctrl+Shift+T","New tab"],["Ctrl+Shift+E","Split right"],
    ["Ctrl+Shift+O","Split down"],["Ctrl+Shift+W","Close pane"],
    ["Ctrl+Shift+= / -","Font size"],["F11","Fullscreen"]]],
  ["Assistant",[["Enter","Send"],["Shift+Enter","Newline"]]],
];
function keyHelpOpen(){
  $("#keyHelpBody").innerHTML=KEY_HELP.map(([group,rows])=>
    `<h3>${esc(group)}</h3>`+rows.map(([k,what])=>
      `<div class="krow"><span>${esc(what)}</span><kbd>${esc(k)}</kbd></div>`).join("")).join("");
  $("#keyHelp").classList.add("open");
}
function keyHelpClose(){$("#keyHelp").classList.remove("open");}
$("#keyHelpClose")&&($("#keyHelpClose").onclick=keyHelpClose);
$("#keyHelp")&&($("#keyHelp").onclick=e=>{if(e.target.id==="keyHelp")keyHelpClose();});
document.addEventListener("keydown",e=>{
  const t=e.target.tagName;
  if(e.key==="?"&&t!=="INPUT"&&t!=="TEXTAREA"&&!e.ctrlKey&&!e.metaKey){
    e.preventDefault();
    $("#keyHelp").classList.contains("open")?keyHelpClose():keyHelpOpen();return;}
  if(e.key==="Escape"&&$("#keyHelp").classList.contains("open"))keyHelpClose();
});

/* ---- history range + export ---- */
let monRange="24h";
async function loadTrend(){
  try{
    const t=await api("/api/trend?range="+encodeURIComponent(monRange));
    $("#monRangeNote").textContent=t.resolution==="hour"
      ?`— hourly averages, ${t.rows.length} point${t.rows.length===1?"":"s"}`
      :`— 1-minute samples, ${t.rows.length} point${t.rows.length===1?"":"s"}`;
    drawMonChart(t.rows);
  }catch(e){toast(e.message,false);}
}
$("#monRange")&&$("#monRange").querySelectorAll("[data-range]").forEach(b=>
  b.onclick=()=>{
    $("#monRange").querySelectorAll("button").forEach(x=>x.classList.remove("on"));
    b.classList.add("on");monRange=b.dataset.range;loadTrend();});
$("#monExport")&&($("#monExport").onclick=()=>{
  const a=document.createElement("a");
  a.href="/api/trendcsv?range="+encodeURIComponent(monRange)+"&t="+TOKEN;
  a.download=`perch-history-${monRange}.csv`;
  document.body.appendChild(a);a.click();a.remove();
  toast("history exported");});

/* ---- periodic digest ---- */
async function loadDigest(){
  try{
    const d=await api("/api/digest");
    if(!$("#dgDay").options.length){
      $("#dgDay").innerHTML=d.days.map((n,i)=>`<option value="${i}">${esc(n)}</option>`).join("");
      $("#dgHour").innerHTML=Array.from({length:24},(_,h)=>
        `<option value="${h}">${String(h).padStart(2,"0")}:00</option>`).join("");
    }
    $("#dgOn").checked=!!d.cfg.enabled;
    $("#dgDay").value=d.cfg.day;$("#dgHour").value=d.cfg.hour;
    $("#dgPreview").textContent=d.preview;
    $("#dgStat").textContent=d.last?"last sent "+ago(d.last):"never sent";
  }catch(e){}
}
async function saveDigest(){
  collectChannels();
  ntCfg.digest={enabled:$("#dgOn").checked,day:+$("#dgDay").value,
    hour:+$("#dgHour").value};
  await api("/api/notifyconfig",{method:"POST",body:JSON.stringify(ntCfg)});
}
$("#dgSave")&&($("#dgSave").onclick=async()=>{
  try{await saveDigest();$("#dgStat").textContent="saved ✓";toast("digest schedule saved");}
  catch(e){toast(e.message,false);}});
$("#dgTest")&&($("#dgTest").onclick=async()=>{
  try{const r=await api("/api/digestsend",{method:"POST",body:"{}"});
    $("#dgPreview").textContent=r.text;toast("digest sent to your channels");}
  catch(e){toast(e.message,false);}});

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
$("#monAllOn")&&($("#monAllOn").onclick=()=>{
  document.querySelectorAll(".mon-on").forEach(c=>c.checked=true);
  $("#monStat").textContent="all rules ticked — hit Save rules";});
$("#monAllOff")&&($("#monAllOff").onclick=()=>{
  document.querySelectorAll(".mon-on").forEach(c=>c.checked=false);
  $("#monStat").textContent="all rules unticked — hit Save rules";});

/* ---- alerting master switch (stop / start / snooze / clear history) ---- */
let acCtl={enabled:true,until:0};
function renderAlertCtl(ctl){
  acCtl=ctl;
  const on=ctl.enabled!==false;
  const until=ctl.until?new Date(ctl.until*1000):null;
  $("#acState").innerHTML=on
    ?'🟢 alerting is on'
    :(until?`⏸ snoozed until ${until.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}`
           :"⏹ alerts stopped");
  $("#acState").style.color=on?"":"var(--serious)";
  $("#acToggle").textContent=on?"⏸ Stop alerts":"▶ Start alerts";
  // an update badge on the nav tab makes a muted system obvious from any tab
  const nav=document.querySelector('nav button[data-tab="monitor"]');
  if(nav)nav.textContent=on?"🚨 Monitor":"🔕 Monitor";
}
async function alertCtl(action,minutes){
  try{
    const r=await api("/api/alertctl",{method:"POST",
      body:JSON.stringify({action,minutes:minutes||0})});
    renderAlertCtl(r.ctl);
    toast(action==="clear"?"alert history cleared"
      :action==="start"?"alerts started"
      :action==="snooze"?`alerts snoozed for ${minutes} minutes`:"alerts stopped");
    if(action==="clear")loadMonitor();
  }catch(e){toast(e.message,false);}
}
$("#acToggle")&&($("#acToggle").onclick=()=>
  alertCtl(acCtl.enabled===false?"start":"stop"));
document.querySelectorAll("[data-snooze]").forEach(b=>
  b.onclick=()=>alertCtl("snooze",+b.dataset.snooze));
$("#acClear")&&($("#acClear").onclick=()=>{
  if(confirm("Delete the recorded alert history? Rules and channels stay as they are."))
    alertCtl("clear");});
// reflect a stopped/snoozed state in the sidebar even before Monitor is opened
(async()=>{try{renderAlertCtl(await api("/api/alertctl"));}catch(e){}})();


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
  // unescaping runs on the raw text: the input is a string literal, which is
  // only valid JSON on its own when it still has its surrounding quotes
  if(act==="unstr"){
    const raw=$("#jIn").value.trim();
    if(!raw){$("#jStat").textContent="⚠ nothing to unescape";return;}
    let inner;
    try{
      inner=(raw.startsWith('"')&&raw.endsWith('"'))
        ?JSON.parse(raw)                 // "{\"a\":1}"
        :JSON.parse('"'+raw+'"');        // {\"a\":1}  — quotes omitted
    }catch(e){
      $("#jStat").textContent="⚠ not an escaped string: "+e.message;
      toast("not an escaped JSON string",false);return;
    }
    try{
      $("#jOut").value=JSON.stringify(JSON.parse(inner),null,2);
      $("#jStat").textContent="unescaped and formatted ✓";
    }catch(e){                            // valid escaping, but not JSON inside
      $("#jOut").value=inner;
      $("#jStat").textContent="unescaped ✓ (contents aren't JSON)";
    }
    return;
  }
  const o=jParse();if(o===undefined)return;
  if(act==="fmt")$("#jOut").value=JSON.stringify(o,null,2);
  if(act==="min")$("#jOut").value=JSON.stringify(o);
  if(act==="sort")$("#jOut").value=JSON.stringify(jSort(o),null,2);
  // minified first, so the embedded copy carries no formatting whitespace
  if(act==="str")$("#jOut").value=JSON.stringify(JSON.stringify(o));
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

