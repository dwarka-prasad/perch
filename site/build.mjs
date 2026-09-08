// Builds the Perch product site into site/dist: landing + README/CHANGELOG/CONTRIBUTING/ROADMAP pages + screenshot gallery.
import { marked } from "marked";
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "site", "dist");
mkdirSync(path.join(out, "docs"), { recursive: true });
mkdirSync(path.join(out, "img"), { recursive: true });
for (const f of readdirSync(path.join(root, "docs"))) if (/\.(png|gif|jpg)$/.test(f)) copyFileSync(path.join(root, "docs", f), path.join(out, "img", f));
copyFileSync(path.join(root, "packaging", "perch.svg"), path.join(out, "perch.svg"));

const BASE = "/perch";
const version = readFileSync(path.join(root, "setup.cfg"), "utf8").match(/^version\s*=\s*(.+)$/m)?.[1]?.trim() ?? "";
const pages = [
  { slug: "readme", title: "Guide", file: "README.md" },
  { slug: "roadmap", title: "Roadmap", file: "ROADMAP.md" },
  { slug: "changelog", title: "Changelog", file: "CHANGELOG.md" },
  { slug: "contributing", title: "Contributing", file: "CONTRIBUTING.md" },
];
marked.use({ gfm: true });
const css = readFileSync(path.join(root, "site", "site.css"), "utf8");
const nav = pages.map((p) => `<a href="${BASE}/docs/${p.slug}.html" data-slug="${p.slug}">${p.title}</a>`).join("");
const shell = (title, body, { slug = "", docs = true } = {}) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} · Perch</title><meta name="description" content="Perch: your Linux machine, at a glance. A self-hosted system and developer dashboard with monitoring, alerts, security, storage tools, terminal, Docker, packages and an AI assistant.">
<meta property="og:title" content="${title} · Perch"><meta property="og:image" content="https://dwarka-prasad.github.io${BASE}/img/overview.png">
<link rel="icon" href="${BASE}/perch.svg">
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>${css}</style>
<script>(function(){try{var t=localStorage.getItem("perch_site_theme")||(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light");document.documentElement.setAttribute("data-theme",t)}catch(e){}})();</script>
</head><body class="${docs ? "docs" : "landing"}">
<header class="top"><a class="brand" href="${BASE}/"><img src="${BASE}/perch.svg" alt="" width="26" height="26">Perch <span class="ver">v${version}</span></a>
<nav><a href="${BASE}/docs/readme.html">Guide</a><a href="${BASE}/docs/roadmap.html">Roadmap</a><a href="${BASE}/docs/changelog.html">Changelog</a><a href="https://github.com/dwarka-prasad/perch">GitHub</a><button id="theme" aria-label="Toggle theme">◐</button></nav></header>
${docs ? `<div class="wrap"><aside class="side">${nav}</aside><main class="content" data-slug="${slug}">${body}</main></div>` : body}
<footer>Perch · MIT · <a href="https://github.com/dwarka-prasad/perch">Source</a> · built by <a href="https://dwarka-prasad.github.io/">Dwarka Prasad Bairwa</a></footer>
<script src="https://cdn.jsdelivr.net/npm/lucide@0.469.0/dist/umd/lucide.min.js"></script>
<script type="module">
import { animate, inView, stagger } from "https://cdn.jsdelivr.net/npm/motion@11.15.0/+esm";
window.lucide?.createIcons();
document.getElementById("theme").onclick = () => { const n = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark"; document.documentElement.setAttribute("data-theme", n); localStorage.setItem("perch_site_theme", n); };
const s = document.querySelector("main[data-slug]")?.dataset.slug; if (s) document.querySelector('.side a[data-slug="'+s+'"]')?.classList.add("on");
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
for (const el of document.querySelectorAll("[data-reveal]")) { if (reduce) { el.classList.add("in"); continue; } inView(el, () => el.classList.add("in"), { margin: "0px 0px -10% 0px" }); }
if (document.body.classList.contains("landing") && !reduce) animate(".hero [data-reveal]", { opacity: [0, 1], y: [16, 0] }, { delay: stagger(0.08, { startDelay: 0.05 }), duration: 0.7, easing: [0.22, 1, 0.36, 1] });
// gallery lightbox
const lb = document.getElementById("lb"); if (lb) { for (const img of document.querySelectorAll(".gallery img")) img.onclick = () => { lb.querySelector("img").src = img.src; lb.querySelector("p").textContent = img.alt; lb.classList.add("on"); }; lb.onclick = () => lb.classList.remove("on"); addEventListener("keydown", (e) => e.key === "Escape" && lb.classList.remove("on")); }
// install tabs
for (const b of document.querySelectorAll(".tabs button")) b.onclick = () => { document.querySelectorAll(".tabs button").forEach((x) => x.classList.toggle("on", x === b)); document.querySelectorAll(".tabpanes pre").forEach((p) => p.classList.toggle("on", p.dataset.pane === b.dataset.tab)); };
// live stars
fetch("https://api.github.com/repos/dwarka-prasad/perch").then((r) => r.ok ? r.json() : null).then((d) => { if (!d) return; const el = document.getElementById("stars"); if (el) el.textContent = d.stargazers_count; }).catch(() => {});
</script></body></html>`;

for (const p of pages) {
  let md = readFileSync(path.join(root, p.file), "utf8");
  md = md.replace(/\]\(docs\/([^)]+\.(?:png|gif))\)/g, `](${BASE}/img/$1)`).replace(/src="docs\//g, `src="${BASE}/img/`);
  md = md.replace(/\]\((CONTRIBUTING|CHANGELOG|ROADMAP|README)\.md\)/g, (_, n) => `](${BASE}/docs/${n.toLowerCase()}.html)`);
  writeFileSync(path.join(out, "docs", `${p.slug}.html`), shell(p.title, marked.parse(md), { slug: p.slug }));
}
writeFileSync(path.join(out, "docs", "index.html"), `<!doctype html><meta http-equiv="refresh" content="0; url=${BASE}/docs/readme.html">`);
writeFileSync(path.join(out, "index.html"), shell("Your machine, at a glance", readFileSync(path.join(root, "site", "landing.html"), "utf8").replaceAll("{{VERSION}}", version), { docs: false }));
writeFileSync(path.join(out, ".nojekyll"), "");
console.log(`built landing + ${pages.length} pages (v${version})`);
