/* AI Agent Patterns & Guardrails — offline service worker.
 *
 * The app advertises itself as LAN/air-gap friendly: the catalog, filters,
 * diagrams (vendored Mermaid) and saved work all run locally. This worker
 * makes that literally true — after the first visit the whole shell
 * (html/css/js/data/design) is served from cache with no network.
 *
 * Strategy
 *   install   precache the app shell (PRECACHE below)
 *   fetch     GET, same-origin, non-/api:
 *               network-first, fall back to the cached copy
 *             (never caches the LLM proxy or the diag beacon)
 *
 * Bump VERSION whenever the shell changes; activate() drops older caches.
 * The precache list is kept in sync by test/data.test.mjs.
 */
const VERSION = "aap-v4";

const PRECACHE = [
  "index.html",
  "css/styles.css",
  "js/app.js",
  "js/project.js",
  "js/workflow.js",
  "js/ressets.js",
  "js/player.js",
  "js/llm.js",
  "js/context.js",
  "js/copilot.js",
  "js/patterns.js",
  "js/scenarios.js",
  "js/cascades.js",
  "js/coverage.js",
  "js/deploy.js",
  "js/blueprints.js",
  "js/palette.js",
  "js/shortcuts.js",
  "js/help.js",
  "js/landing.js",
  "js/dashboard.js",
  "js/report.js",
  "js/live.js",
  "js/design.js",
  "js/guardrail.js",
  "js/discovery.js",
  "js/vendor/mermaid.min.js",
  "data/patterns.json",
  "data/scenarios.json",
  "data/traces.json",
  "data/cascades.json",
  "data/coverage.json",
  "design/01-system-context.md",
  "design/02-uml.md",
  "design/03-control-flow.md",
  "design/04-guardrails.md",
  "design/05-data-model.md",
  "design/06-threat-model.md",
  "design/07-architect-analysis.md",
  "design/08-runtime-offline.md",
];

/* Cache the *decoded* body: fetch() hands back a decompressed stream while
   the headers may still say `Content-Encoding: gzip`. Re-serving those bytes
   with that header double-decodes, so strip the encoding/length headers when
   we clone a response into the cache. */
async function stash(cache, req, res) {
  const headers = new Headers(res.headers);
  headers.delete("content-encoding");
  headers.delete("content-length");
  const body = await res.blob();
  headers.set("x-aap-len", String(body.size));   // size for the perf panel (cheap read)
  await cache.put(req, new Response(body, { status: res.status, statusText: res.statusText, headers }));
}

async function precache() {
  const cache = await caches.open(VERSION);
  await Promise.all(PRECACHE.map(async (url) => {
    // Default cache mode: on a first visit these were just fetched by the page,
    // so this revalidates (or reads the immutable vendor copy) instead of
    // re-downloading the whole shell a second time.
    const res = await fetch(url);
    if (!res.ok) throw new Error(`precache failed: ${url} (${res.status})`);
    await stash(cache, url, res);
  }));
}

self.addEventListener("install", (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;                       // POST /api/llm/chat
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;        // CDN, data: favicons
  if (url.pathname.startsWith("/api/")) return;           // LLM proxy, diag beacon

  event.respondWith((async () => {
    const cache = await caches.open(VERSION);
    try {
      const fresh = await fetch(req);
      if (fresh && fresh.ok && fresh.type === "basic") await stash(cache, req, fresh.clone());
      return fresh;
    } catch (err) {
      const isDoc = req.mode === "navigate" || (req.destination === "document");
      const hit = (await cache.match(req)) || (isDoc ? await cache.match("index.html") : null);
      if (hit) return hit;
      throw err;
    }
  })());
});
