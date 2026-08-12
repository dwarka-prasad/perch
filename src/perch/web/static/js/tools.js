/* Perch — tools, logs, assistant, git, API client, kernel, drawer, cleanup.
   Part of the frontend, split positionally from one file: the
   scripts are loaded in order and share one global scope, so
   execution order is exactly as it was. */
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

/* ---- ai: floating dock (bottom-right), not a tab ---- */
const AI_PROVIDER_LABEL={"claude-cli":"local Claude Code",anthropic:"Anthropic API",
  openai:"OpenAI-compatible",ollama:"Ollama (local)"};
function aiSetProvider(c){
  const el=$("#aiProv");if(!el||!c)return;
  el.textContent=(AI_PROVIDER_LABEL[c.provider]||c.provider||"")+
    (c.model?` · ${c.model}`:"");
}
let aiProvLoaded=false;
function aiOpen(){
  if(CAPS&&CAPS.ai===false){toast("no AI provider configured — set one in Settings",false);return;}
  // the provider label is only known from the server; fetch it once, lazily
  if(!aiProvLoaded){aiProvLoaded=true;
    api("/api/llm").then(aiSetProvider).catch(()=>{});}
  $("#aiDock").classList.add("open");
  $("#aiFab").classList.add("on");
  $("#aiFab").textContent="✕";
  $("#aiFab").title="Close the assistant (Esc)";
  setTimeout(()=>$("#aiIn").focus(),60);
  const c=$("#aiChat");c.scrollTop=c.scrollHeight;
}
function aiClose(){
  $("#aiDock").classList.remove("open");
  $("#aiFab").classList.remove("on");
  $("#aiFab").textContent="✨";
  $("#aiFab").title="Ask the assistant (Ctrl+I)";
}
function aiToggle(){
  $("#aiDock").classList.contains("open")?aiClose():aiOpen();
}
$("#aiFab")&&($("#aiFab").onclick=aiToggle);
$("#aiClose")&&($("#aiClose").onclick=aiClose);
document.addEventListener("keydown",e=>{
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="i"&&!e.shiftKey){
    e.preventDefault();aiToggle();return;}
  if(e.key==="Escape"&&$("#aiDock").classList.contains("open")
     &&!$("#pal").classList.contains("open"))aiClose();
});
// #ai still works as a deep link, it just opens the dock instead of a tab
if(location.hash.replace("#","")==="ai")setTimeout(aiOpen,300);

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
/* ---- cleanup lenses: duplicates and stale big files ---- */
$("#dupGo")&&($("#dupGo").onclick=async()=>{
  const btn=$("#dupGo");btn.disabled=true;
  $("#dupStat").textContent="scanning… up to 20 s";
  $("#dupBody").innerHTML="";
  try{
    const r=await api("/api/dupes?path="+encodeURIComponent($("#dupPath").value.trim())+
      "&min="+encodeURIComponent($("#dupMin").value.trim()||"1"));
    $("#dupStat").textContent=`${r.groups.length} group(s) · ${fmtB(r.wasted)} reclaimable`+
      (r.truncated?" · stopped early, narrow the folder for a full picture":"");
    $("#dupBody").innerHTML=r.groups.length?'<table><thead><tr><th>Copies</th>'+
      '<th class="num">Each</th><th class="num">Wasted</th><th>Files</th></tr></thead><tbody>'+
      r.groups.map(g=>`<tr>
        <td><b>${g.count}</b></td>
        <td class="num">${fmtB(g.size)}</td>
        <td class="num" style="color:var(--s2)">${fmtB(g.wasted)}</td>
        <td>${g.paths.map(p=>`<div class="mono" style="font-size:11px;
          overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
          <span class="name" data-p="${esc(p)}" data-dir="false">${esc(p)}</span></div>`).join("")}</td>
      </tr>`).join("")+'</tbody></table>'
      :`<span class="muted" style="font-size:12.5px">no duplicates found in ${esc(r.root)}</span>`;
    hookRowActions($("#dupBody"));
  }catch(e){$("#dupStat").textContent="";toast(e.message,false);}
  btn.disabled=false;
});
$("#oldGo")&&($("#oldGo").onclick=async()=>{
  const btn=$("#oldGo");btn.disabled=true;
  $("#oldStat").textContent="scanning… up to 20 s";
  $("#oldBody").innerHTML="";
  try{
    const r=await api("/api/oldfiles?path="+encodeURIComponent($("#oldPath").value.trim())+
      "&min="+encodeURIComponent($("#oldMin").value.trim()||"100")+
      "&days="+encodeURIComponent($("#oldDays").value.trim()||"365"));
    $("#oldStat").textContent=`${r.files.length} file(s) · ${fmtB(r.total)} total`+
      (r.truncated?" · stopped early":"");
    $("#oldBody").innerHTML=r.files.length?'<table><thead><tr><th>File</th>'+
      '<th class="num">Size</th><th class="num">Last touched</th><th></th></tr></thead><tbody>'+
      r.files.slice(0,60).map(f=>`<tr>
        <td class="mono" style="font-size:11.5px;max-width:520px;overflow:hidden;
          text-overflow:ellipsis;white-space:nowrap">
          <span class="name" data-p="${esc(f.path)}" data-dir="false">${esc(f.path)}</span></td>
        <td class="num">${fmtB(f.size)}</td>
        <td class="num muted">${ago(Math.max(f.atime,f.mtime))}</td>
        <td class="num"><button class="btn small" data-goto="${esc(f.path.slice(0,f.path.lastIndexOf("/"))||"/")}">Browse</button></td>
      </tr>`).join("")+'</tbody></table>'
      :`<span class="muted" style="font-size:12.5px">nothing that big and that old in ${esc(r.root)}</span>`;
    hookRowActions($("#oldBody"));
  }catch(e){$("#oldStat").textContent="";toast(e.message,false);}
  btn.disabled=false;
});

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
