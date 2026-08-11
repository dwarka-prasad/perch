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
