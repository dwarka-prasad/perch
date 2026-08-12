#!/usr/bin/env node
/**
 * Frontend smoke tests.
 *
 * `node --check` only proves app.js parses. These drive the real page in
 * headless Chrome over the DevTools Protocol and assert that the app boots,
 * renders live data, and that the interactive surfaces still work — the class
 * of regression a syntax check cannot see.
 *
 * Run:  make test-frontend      (or: node tests/frontend/smoke.mjs)
 * Needs: google-chrome (or chromium) on PATH, and python3 with psutil.
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CHROME = ["google-chrome", "google-chrome-stable", "chromium",
                "chromium-browser"]
  .find(b => spawnSync("which", [b]).status === 0);

const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(...a);

/* ---------------------------------------------------------------- CDP ---- */
class Page {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map();
                    this.errors = []; }
  static async open(base, url) {
    const tab = await (await fetch(`${base}/json/new?${encodeURIComponent(url)}`,
                                   { method: "PUT" })).json();
    const ws = new WebSocket(tab.webSocketDebuggerUrl);
    const p = new Page(ws);
    ws.onmessage = e => {
      const m = JSON.parse(e.data);
      if (m.id && p.pending.has(m.id)) { p.pending.get(m.id)(m.result); p.pending.delete(m.id); }
      if (m.method === "Runtime.exceptionThrown")
        p.errors.push(m.params.exceptionDetails?.exception?.description
                      || m.params.exceptionDetails?.text);
    };
    await new Promise(r => ws.onopen = r);
    await p.send("Runtime.enable");
    return p;
  }
  send(method, params = {}) {
    return new Promise(res => {
      const id = ++this.id; this.pending.set(id, res);
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expr) {
    const r = await this.send("Runtime.evaluate",
      { expression: `(async()=>{ ${expr} })()`, awaitPromise: true,
        returnByValue: true });
    if (r.exceptionDetails)
      throw new Error("page threw: " +
        (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result?.value;
  }
}

/* -------------------------------------------------------------- runner ---- */
const results = [];
async function check(name, fn) {
  try { await fn(); results.push([true, name]); log(`  ok   ${name}`); }
  catch (e) { results.push([false, name, e.message]);
              log(`  FAIL ${name}\n       ${e.message}`); }
}
const eq = (got, want, what) => {
  if (got !== want) throw new Error(`${what}: expected ${want}, got ${got}`);
};
const atLeast = (got, min, what) => {
  if (!(got >= min)) throw new Error(`${what}: expected >= ${min}, got ${got}`);
};

/* ---------------------------------------------------------------- main ---- */
let server, chrome, home, profile;
try {
  if (!CHROME) { log("no chrome/chromium on PATH — skipping frontend smoke tests"); process.exit(0); }

  home = mkdtempSync(join(tmpdir(), "perch-fe-home-"));
  profile = mkdtempSync(join(tmpdir(), "perch-fe-prof-"));
  const port = 9100 + Math.floor(process.pid % 400);

  // The server runs with HOME pointed at a temp dir so the suite never touches
  // the real ~/.config/perch — but that also hides packages installed into the
  // real user site-packages (pip --user), so carry that path explicitly.
  const userSite = spawnSync("python3",
    ["-c", "import site; print(site.getusersitepackages())"],
    { encoding: "utf8" }).stdout?.trim();
  const pythonPath = [join(ROOT, "src"), userSite].filter(Boolean).join(":");

  log(`starting perch on :${port} (HOME=${home})`);
  let serverErr = "";
  server = spawn("python3", ["-c",
    `from perch import server as S; S.PORT=${port}; S.main()`],
    { env: { ...process.env, HOME: home, PYTHONPATH: pythonPath },
      stdio: ["ignore", "ignore", "pipe"] });
  server.stderr.on("data", d => { serverErr += d.toString(); });

  let token = null;
  for (let i = 0; i < 60 && !token; i++) {
    await sleep(500);
    try { token = readFileSync(join(home, ".perch-token"), "utf8").trim(); } catch {}
    if (token) {
      try { const r = await fetch(`http://127.0.0.1:${port}/api/health`);
            if (!r.ok) token = null; } catch { token = null; }
    }
  }
  if (!token)
    throw new Error("perch did not come up" +
      (serverErr ? ":\n" + serverErr.trim().split("\n").slice(-6).join("\n") : ""));

  const cdpPort = port + 1000;
  chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-sandbox",
    `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profile}`,
    "about:blank"], { stdio: "ignore" });
  const base = `http://127.0.0.1:${cdpPort}`;
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    try { await (await fetch(`${base}/json/version`)).json(); break; } catch {}
  }

  const page = await Page.open(base, `http://127.0.0.1:${port}/?t=${token}`);
  await sleep(5000);                      // boot + first round of fetches

  log("running checks:");

  await check("app boots with no uncaught exceptions", async () => {
    const title = await page.eval("return document.title");
    eq(title, "Perch", "document title");
    if (page.errors.length)
      throw new Error("console errors: " + page.errors.join(" | "));
  });

  await check("overview renders live data", async () => {
    const cpu = await page.eval(`return document.querySelector("#cpuV").textContent`);
    if (!/%$/.test(cpu)) throw new Error(`CPU tile shows ${JSON.stringify(cpu)}`);
  });

  await check("default home layout has every core widget", async () => {
    const n = await page.eval(`return [...document.querySelectorAll(
      '#ovGrid > [data-w]:not(.hw-off)')].length`);
    atLeast(n, 13, "visible widgets");
  });

  await check("widget gallery offers the opt-in widgets", async () => {
    const n = await page.eval(`
      document.querySelector("#ovCustomize").click();
      document.querySelector("#ovAdd").click();
      await new Promise(r=>setTimeout(r,300));
      const n=document.querySelectorAll("#ovGalList [data-add]").length;
      document.querySelector("#ovGalClose").click();
      document.querySelector("#ovCustomize").click();
      return n;`);
    atLeast(n, 10, "gallery widgets");
  });

  await check("adding a widget renders it and survives a reload", async () => {
    // homeWrite is the path the UI itself uses: browser cache + server
    await page.eval(`
      homeWrite({order:["cpu","clock"],hidden:[],sizes:{cpu:"s",clock:"s"}});
      applyHome(); await new Promise(r=>setTimeout(r,1500));`);
    const before = await page.eval(
      `return document.querySelector('[data-w="clock"]').innerText.length`);
    atLeast(before, 5, "clock widget content");
    await page.eval(`location.reload(); return 1`);
    await sleep(5000);
    const after = await page.eval(`return [...document.querySelectorAll(
      '#ovGrid > [data-w]:not(.hw-off)')].map(e=>e.dataset.w).join(",")`);
    eq(after, "cpu,clock", "layout after reload");
  });

  await check("layout persists server-side, not just in the browser", async () => {
    const r = await fetch(`http://127.0.0.1:${port}/api/homelayout`,
                          { headers: { "X-Token": token } });
    const j = await r.json();
    eq((j.layout?.order || []).join(","), "cpu,clock", "server-stored order");
  });

  await check("widgets resize by dragging the corner handle", async () => {
    const out = await page.eval(`
      homeWrite({order:["cpu","mem"],hidden:[],sizes:{}});
      applyHome(); await new Promise(r=>setTimeout(r,900));
      document.querySelector("#ovCustomize").click();
      const el=document.querySelector('[data-w="cpu"]');
      const before={w:el.dataset.cols,h:el.dataset.rows};
      const handle=el.querySelector(".hwres");
      const r=handle.getBoundingClientRect();
      const opts=b=>({bubbles:true,clientX:b.x,clientY:b.y,pointerId:1});
      // grab the corner and drag right and down by roughly one cell
      handle.dispatchEvent(new PointerEvent("pointerdown",
        opts({x:r.left+2,y:r.top+2})));
      document.dispatchEvent(new PointerEvent("pointermove",
        opts({x:r.left+2+260,y:r.top+2+150})));
      document.dispatchEvent(new PointerEvent("pointerup",
        opts({x:r.left+2+260,y:r.top+2+150})));
      await new Promise(r2=>setTimeout(r2,900));
      const after={w:el.dataset.cols,h:el.dataset.rows,
                   minH:el.style.minHeight,col:el.style.gridColumn};
      document.querySelector("#ovCustomize").click();
      return JSON.stringify([before,after]);`);
    const [before, after] = JSON.parse(out);
    eq(before.w, "1", "starting width");
    eq(before.h, "1", "starting height");
    if (!(after.w === "2" || after.w === "full"))
      throw new Error(`drag right should widen, got ${after.w}`);
    atLeast(Number(after.h), 2, "height after dragging down");
    if (!after.minH) throw new Error("taller widget got no min-height");
    // and the new size must survive to the server
    const r = await fetch(`http://127.0.0.1:${port}/api/homelayout`,
                          { headers: { "X-Token": token } });
    const saved = (await r.json()).layout?.sizes?.cpu;
    if (!saved || typeof saved !== "object")
      throw new Error(`server stored ${JSON.stringify(saved)}`);
    atLeast(Number(saved.h), 2, "persisted height");
  });

  await check("home file search queries the backend", async () => {
    // A throwaway HOME has no filename index yet (building one walks the whole
    // filesystem), so assert the query round-trips rather than that it matched.
    const status = await page.eval(`
      goTab("overview");
      homeWrite({order:["search"],hidden:[],sizes:{search:"full"}});
      applyHome(); await new Promise(r=>setTimeout(r,600));
      const el=document.querySelector("#ovSq");
      el.value="perch"; el.dispatchEvent(new Event("input"));
      await new Promise(r=>setTimeout(r,3000));
      return document.querySelector("#ovSqStatus").textContent.trim();`);
    if (!status) throw new Error("search produced no status text at all");
    if (/^searching/.test(status)) throw new Error("search never came back");
  });

  await check("alerting master switch stops and starts", async () => {
    const out = await page.eval(`
      goTab("monitor"); await new Promise(r=>setTimeout(r,1500));
      const before=document.querySelector("#acState").textContent.trim();
      document.querySelector("#acToggle").click();
      await new Promise(r=>setTimeout(r,900));
      const after=document.querySelector("#acState").textContent.trim();
      document.querySelector("#acToggle").click();
      await new Promise(r=>setTimeout(r,900));
      return JSON.stringify([before,after,
        document.querySelector("#acState").textContent.trim()]);`);
    const [before, after, restored] = JSON.parse(out);
    if (!/on/.test(before)) throw new Error(`expected alerting on, got ${before}`);
    if (!/stopped/.test(after)) throw new Error(`expected stopped, got ${after}`);
    if (!/on/.test(restored)) throw new Error(`expected restored, got ${restored}`);
  });

  await check("custom alert rules round-trip through the server", async () => {
    const saved = await page.eval(`
      document.querySelector("#crAdd").click();
      document.querySelector(".crName").value="api up";
      document.querySelector(".crKind").value="port";
      document.querySelector(".crTarget").value="8080";
      document.querySelector("#crSave").click();
      await new Promise(r=>setTimeout(r,1200));
      return document.querySelectorAll(".crName").length;`);
    atLeast(saved, 1, "saved custom rules");
    const r = await fetch(`http://127.0.0.1:${port}/api/monitor?brief=1`,
                          { headers: { "X-Token": token } });
    const j = await r.json();
    eq((j.custom || []).length, 1, "server-side custom rules");
    eq(j.custom[0].kind, "port", "rule kind");
  });

  await check("network tab filters ports and guards Perch's own", async () => {
    const out = await page.eval(`
      goTab("net"); await new Promise(r=>setTimeout(r,2000));
      const all=document.querySelectorAll("#ports tbody tr").length;
      document.querySelector("#portQ").value="${port}";
      document.querySelector("#portQ").dispatchEvent(new Event("input"));
      const filtered=document.querySelectorAll("#ports tbody tr").length;
      const self=document.querySelector("#ports tbody tr").innerText.includes("Perch itself");
      document.querySelector("#portQ").value="";
      document.querySelector("#portQ").dispatchEvent(new Event("input"));
      return JSON.stringify([all,filtered,self]);`);
    const [all, filtered, self] = JSON.parse(out);
    atLeast(all, 1, "port rows");
    eq(filtered, 1, "rows after filtering to our own port");
    eq(self, true, "own port marked as Perch itself");
  });

  await check("assistant is a floating dock, not a sidebar tab", async () => {
    // With no AI provider installed (a bare CI runner) the button hides itself,
    // exactly as the old tab did — so assert whichever behaviour applies here.
    const out = await page.eval(`
      const navAI=!!document.querySelector('nav button[data-tab="ai"]');
      const fab=document.querySelector("#aiFab");
      // CAPS is a top-level 'let', so it is a global binding, not window.CAPS
      const hasProvider=!(typeof CAPS!=="undefined" && CAPS && CAPS.ai===false);
      const hidden=getComputedStyle(fab).display==="none";
      let opened=null, focused=null, closed=null, bottomRight=null;
      if(hasProvider){
        fab.click(); await new Promise(r=>setTimeout(r,500));
        opened=document.querySelector("#aiDock").classList.contains("open");
        focused=document.activeElement.id;
        document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}));
        await new Promise(r=>setTimeout(r,300));
        closed=!document.querySelector("#aiDock").classList.contains("open");
        const r=fab.getBoundingClientRect();
        bottomRight=(innerWidth-r.right)<120 && (innerHeight-r.bottom)<120;
      }
      return JSON.stringify([navAI,hasProvider,hidden,opened,focused,closed,bottomRight]);`);
    const [navAI, hasProvider, hidden, opened, focused, closed, bottomRight] =
      JSON.parse(out);
    eq(navAI, false, "AI still in the sidebar");
    if (!hasProvider) {
      eq(hidden, true, "button should hide itself with no AI provider");
      log("       (no AI provider here — checked the hidden-button path)");
      return;
    }
    eq(hidden, false, "floating button visible when a provider is configured");
    eq(opened, true, "dock opens from the floating button");
    eq(focused, "aiIn", "focused element after opening");
    eq(closed, true, "Escape closes the dock");
    eq(bottomRight, true, "floating button anchored bottom-right");
  });

  await check("installed packages list with update/remove actions", async () => {
    const out = await page.eval(`
      goTab("packages"); await new Promise(r=>setTimeout(r,5000));
      const rows=document.querySelectorAll("#instTable tbody tr").length;
      const acts=document.querySelectorAll("#instTable [data-pkgup]").length
               && document.querySelectorAll("#instTable [data-pkgrm]").length;
      const count=document.querySelector("#instCount").textContent;
      return JSON.stringify([rows, !!acts, count]);`);
    const [rows, acts, count] = JSON.parse(out);
    atLeast(rows, 1, "installed package rows");
    eq(acts, true, "update/remove buttons present");
    if (!/installed/.test(count)) throw new Error(`count line reads ${count}`);
  });

  await check("about panel reports the running version", async () => {
    const out = await page.eval(`
      goTab("settings"); await new Promise(r=>setTimeout(r,2500));
      return JSON.stringify([document.querySelector("#brandVer").textContent,
                             document.querySelector("#aboutVer").textContent,
                             document.querySelector("#aboutBody").innerText.length]);`);
    const [brand, about, bodyLen] = JSON.parse(out);
    if (!/^v\d+\.\d+/.test(brand)) throw new Error(`sidebar version reads ${brand}`);
    if (!/version \d+\.\d+/.test(about)) throw new Error(`about reads ${about}`);
    atLeast(bodyLen, 40, "about panel content");
  });

  await check("JSON tools escape and unescape round-trip", async () => {
    const out = await page.eval(`
      goTab("tools"); await new Promise(r=>setTimeout(r,600));
      const src='{"a":1,"b":"say \\\\"hi\\\\"","c":[1,2]}';
      const inp=document.querySelector("#jIn"), outp=document.querySelector("#jOut");
      inp.value=src;
      document.querySelector('[data-j="str"]').click();
      const escaped=outp.value;
      inp.value=escaped;
      document.querySelector('[data-j="unstr"]').click();
      const back=outp.value;
      return JSON.stringify([src, escaped, back]);`);
    const [src, escaped, back] = JSON.parse(out);
    if (!escaped.startsWith('"') || !escaped.includes('\\"'))
      throw new Error(`escape produced ${escaped}`);
    if (JSON.stringify(JSON.parse(back)) !== JSON.stringify(JSON.parse(src)))
      throw new Error(`round-trip changed the document: ${back}`);
  });

  await check("security overview scores and lists findings", async () => {
    const out = await page.eval(`
      goTab("security"); await new Promise(r=>setTimeout(r,4000));
      return JSON.stringify([
        document.querySelector("#secScore").innerText,
        document.querySelector("#secFindings").innerText.length,
        document.querySelector("#secAdmins").innerText.includes("Automatic")]);`);
    const [score, findingsLen, hasAuto] = JSON.parse(out);
    if (!/\d+\/100/.test(score)) throw new Error(`score reads ${score}`);
    atLeast(findingsLen, 10, "findings text");
    eq(hasAuto, true, "automatic-updates line present");
  });

  await check("history ranges switch between minute and hourly", async () => {
    const out = await page.eval(`
      goTab("monitor"); await new Promise(r=>setTimeout(r,2500));
      const a=document.querySelector("#monRangeNote").textContent;
      document.querySelector('[data-range="30d"]').click();
      await new Promise(r=>setTimeout(r,2000));
      const b=document.querySelector("#monRangeNote").textContent;
      document.querySelector('[data-range="24h"]').click();
      await new Promise(r=>setTimeout(r,1500));
      return JSON.stringify([a,b]);`);
    const [day, month] = JSON.parse(out);
    if (!/minute/.test(day)) throw new Error(`24h note reads ${day}`);
    if (!/hourly/.test(month)) throw new Error(`30d note reads ${month}`);
  });

  await check("history exports as CSV", async () => {
    const r = await fetch(`http://127.0.0.1:${port}/api/trendcsv?range=24h`,
                          { headers: { "X-Token": token } });
    const text = await r.text();
    const ctype = (r.headers.get("content-type") || "").split(";")[0].trim();
    eq(ctype, "text/csv", "content type");
    if (!text.startsWith("time,cpu"))
      throw new Error(`csv header reads ${text.slice(0, 40)}`);
  });

  await check("custom rule can be tested before saving", async () => {
    const out = await page.eval(`
      goTab("monitor"); await new Promise(r=>setTimeout(r,2000));
      document.querySelector("#crAdd").click();
      document.querySelector(".crName").value="nothing listens here";
      document.querySelector(".crKind").value="port";
      document.querySelector(".crTarget").value="65500";
      document.querySelector("[data-crtest]").click();
      await new Promise(r=>setTimeout(r,1500));
      return document.querySelector("#crStat").innerText;`);
    if (!/would alert/.test(out))
      throw new Error(`expected a breach for an unused port, got: ${out}`);
  });

  await check("keyboard shortcut sheet opens on ? and closes on Esc", async () => {
    const out = await page.eval(`
      document.dispatchEvent(new KeyboardEvent("keydown",{key:"?",bubbles:true}));
      await new Promise(r=>setTimeout(r,300));
      const open=document.querySelector("#keyHelp").classList.contains("open");
      const rows=document.querySelectorAll("#keyHelpBody .krow").length;
      document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}));
      await new Promise(r=>setTimeout(r,300));
      const closed=!document.querySelector("#keyHelp").classList.contains("open");
      return JSON.stringify([open,rows,closed]);`);
    const [open, rows, closed] = JSON.parse(out);
    eq(open, true, "sheet opens on ?");
    atLeast(rows, 8, "listed shortcuts");
    eq(closed, true, "sheet closes on Escape");
  });

  await check("fleet view reads and writes its host list", async () => {
    const out = await page.eval(`
      goTab("fleet"); await new Promise(r=>setTimeout(r,1500));
      document.querySelector("#fleetAdd").click();
      document.querySelector(".flName").value="node-a";
      document.querySelector(".flUrl").value="http://127.0.0.1:9";
      document.querySelector(".flTok").value="not-a-real-token";
      document.querySelector("#fleetSave").click();
      await new Promise(r=>setTimeout(r,4000));
      return JSON.stringify([
        document.querySelector("#fleetStat").textContent,
        document.querySelectorAll("#fleetBody tbody tr").length,
        document.querySelector("#fleetBody").innerText]);`);
    const [stat, rows, body] = JSON.parse(out);
    if (!/saved 1/.test(stat)) throw new Error(`save status reads ${stat}`);
    eq(rows, 1, "fleet rows");
    if (!/node-a/.test(body)) throw new Error("host name missing from the grid");
    // an unreachable host must be reported, not silently dropped
    if (!/unreachable|refused|Connection|Error|error/i.test(body))
      throw new Error(`expected an error state, got: ${body.slice(0,80)}`);
    // tokens must never come back to the browser
    const cfg = await (await fetch(`http://127.0.0.1:${port}/api/fleetconfig`,
                                   { headers: { "X-Token": token } })).json();
    if (JSON.stringify(cfg).includes("not-a-real-token"))
      throw new Error("fleet config leaked a token to the client");
  });

  await check("file browser lists the home directory", async () => {
    const out = await page.eval(`
      goTab("files"); await new Promise(r=>setTimeout(r,2500));
      return JSON.stringify([
        document.querySelectorAll("#ftable tbody tr").length,
        document.querySelector("#fCrumbs").innerText.length]);`);
    const [rows, crumbs] = JSON.parse(out);
    atLeast(rows, 1, "file rows");
    atLeast(crumbs, 1, "breadcrumb text");
  });

  await check("terminal attaches a live shell", async () => {
    const out = await page.eval(`
      goTab("term"); await new Promise(r=>setTimeout(r,4000));
      const panes=document.querySelectorAll("#termStage .term-pane").length;
      const text=document.querySelector("#termStage").innerText||"";
      return JSON.stringify([panes, text.length]);`);
    const [panes, textLen] = JSON.parse(out);
    atLeast(panes, 1, "terminal panes");
    atLeast(textLen, 1, "terminal output (a prompt should have rendered)");
  });

  await check("API client sends a request and shows the response", async () => {
    const out = await page.eval(`
      goTab("api"); await new Promise(r=>setTimeout(r,1200));
      document.querySelector("#hUrl2").value="http://127.0.0.1:${port}/api/health";
      document.querySelector("#hSend2").click();
      await new Promise(r=>setTimeout(r,3000));
      return JSON.stringify([
        document.querySelector("#hResMeta2").innerText,
        document.querySelector("#hRes2").textContent]);`);
    const [meta, bodyText] = JSON.parse(out);
    if (!/200/.test(meta)) throw new Error(`response meta reads ${meta}`);
    if (!/ok/.test(bodyText)) throw new Error(`response body reads ${bodyText}`);
  });

  await check("database browser runs a SQLite query", async () => {
    // sqlite_query refuses a path that is not a real database, so make one
    const dbPath = join(home, "probe.db");
    const made = spawnSync("python3", ["-c",
      `import sqlite3;c=sqlite3.connect(${JSON.stringify(dbPath)});` +
      `c.execute("CREATE TABLE IF NOT EXISTS notes(id INTEGER, body TEXT)");` +
      `c.execute("INSERT INTO notes VALUES (1, 'hello')");c.commit();c.close()`]);
    if (made.status !== 0)
      throw new Error("could not create the probe database");
    const out = await page.eval(`
      goTab("db"); await new Promise(r=>setTimeout(r,1200));
      document.querySelector("#dbPath").value="${home}/probe.db";
      document.querySelector("#dbSql").value="SELECT id, body FROM notes";
      document.querySelector("#dbWrite").checked=false;
      document.querySelector("#dbRun").click();
      await new Promise(r=>setTimeout(r,2500));
      return JSON.stringify([document.querySelector("#dbStat").textContent,
                             document.querySelector("#dbResult").innerText]);`);
    const [stat, table] = JSON.parse(out);
    if (!/hello/.test(table))
      throw new Error(`query result missing (status: ${stat}, table: ${table})`);
  });

  await check("traffic tab shows connections and interface rates", async () => {
    const out = await page.eval(`
      goTab("traffic"); await new Promise(r=>setTimeout(r,3500));
      const conn=document.querySelectorAll("#connTable tbody tr").length;
      const io=document.querySelectorAll("#ioBody tbody tr").length;
      const meta=document.querySelector("#connMeta").textContent;
      // the filter narrows to listening sockets only
      document.querySelector('[data-kind="LISTEN"]').click();
      const listening=[...document.querySelectorAll("#connTable tbody tr")]
        .every(r=>/LISTEN|no connections/.test(r.innerText));
      document.querySelector('[data-kind="all"]').click();
      return JSON.stringify([conn, io, meta, listening,
                             !!document.querySelector("#capGo")]);`);
    const [conn, io, meta, listening, hasCapture] = JSON.parse(out);
    atLeast(conn, 1, "connection rows");
    atLeast(io, 1, "interface rows");
    if (!/total/.test(meta)) throw new Error(`connection meta reads ${meta}`);
    eq(listening, true, "state filter should leave only listening sockets");
    eq(hasCapture, true, "capture controls present");
  });

  await check("capture refuses a filter that smuggles an option", async () => {
    const r = await fetch(`http://127.0.0.1:${port}/api/capture`, {
      method: "POST",
      headers: { "X-Token": token, "Content-Type": "application/json" },
      body: JSON.stringify({ iface: "any", filter: "port 80 -w /etc/shadow" }),
    });
    eq(r.status, 400, "status for an option-smuggling filter");
    const j = await r.json();
    if (!/option/i.test(j.error || ""))
      throw new Error(`unhelpful error: ${j.error}`);
  });

  await check("every tab opens without throwing", async () => {
    const errs = await page.eval(`
      const tabs=[...document.querySelectorAll("nav button[data-tab]")]
        .map(b=>b.dataset.tab).filter(t=>t!=="term");
      for(const t of tabs){ goTab(t); await new Promise(r=>setTimeout(r,220)); }
      goTab("overview");
      return "";`);
    if (page.errors.length)
      throw new Error("console errors: " + page.errors.slice(0, 3).join(" | "));
  });

} catch (e) {
  results.push([false, "harness", e.message]);
  log("harness error: " + e.message);
} finally {
  for (const p of [chrome, server]) { try { p?.kill("SIGKILL"); } catch {} }
  for (const d of [home, profile]) {
    if (d && existsSync(d)) { try { rmSync(d, { recursive: true, force: true }); } catch {} }
  }
}

const failed = results.filter(r => !r[0]);
log(`\n${results.length - failed.length}/${results.length} frontend checks passed`);
process.exit(failed.length ? 1 : 0);
