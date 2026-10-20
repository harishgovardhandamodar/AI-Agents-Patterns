import puppeteer from 'puppeteer';
const URL = process.argv[2] || 'http://localhost:5199/';
const browser = await puppeteer.launch({ headless: 'shell', executablePath: process.env.CHROME_BIN, args: ['--no-sandbox','--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
const errs = [];
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
await page.goto(URL, { waitUntil: 'networkidle2', timeout: 30000 });
await new Promise(r => setTimeout(r, 2500));

// 1. dpStack pattern ids — are they real catalog ids?
console.log('=== DEPLOY STACK -> BLUEPRINT FEASIBILITY ===');
console.log(await page.evaluate(() => {
  dpState.done = true;
  const s = dpStack();
  const withPat = s.filter(x => x.pat);
  const valid = withPat.filter(x => DATA.patterns.patterns.some(p => p.id === x.pat));
  return JSON.stringify({ total: s.length, withPat: withPat.length, validPatIds: valid.length, sample: withPat.slice(0,5).map(x=>x.pat) }, null, 1);
}));

// 2. Guardrail lab — what does it produce, and can it map to patterns?
console.log('\n=== GUARDRAIL LAB OUTPUT SHAPE ===');
console.log(await page.evaluate(() => {
  const it = guardState.items[0];
  return JSON.stringify({
    keys: Object.keys(it),
    meta: it.meta,
    controls: (it.controls||[]).slice(0,3),
    controlCount: (it.controls||[]).length,
    cascadeRules: (it.cascadeRules||[]).length ? it.cascadeRules.length : (it.rules||[]).length,
    allKeys: Object.keys(it)
  }, null, 1);
}));

// 3. Mitigation planner state — can it be a work product?
console.log('\n=== MITIGATION PLANNER STATE ===');
console.log(await page.evaluate(() => {
  const m = JSON.parse(localStorage.getItem('aap.mitigations') || '{}');
  return JSON.stringify({ keys: Object.keys(m).length, sample: Object.entries(m).slice(0,2) }, null, 1);
}));

// 4. Undo coverage — which tools push to the undo stack?
console.log('\n=== UNDO COVERAGE ===');
console.log(await page.evaluate(() => {
  const src = ['app','blueprints','deploy','guardrail','cascades','copilot','discovery','dashboard','scenarios','patterns','coverage','live','design'];
  const out = {};
  // use the live undo stack labels by triggering? simpler: read function source
  return JSON.stringify({ note: 'checked statically' });
}));

// 5. Does the app remember a "system name" across tools? (project spine)
console.log('\n=== PROJECT SPINE ===');
console.log(await page.evaluate(() => {
  return JSON.stringify({
    dpSystem: dpState.a.system,
    bpName: bpState.name,
    same: dpState.a.system === bpState.name,
    guardTitles: guardState.items.map(i=>i.title)
  }, null, 1);
}));

// 6. Alt+digit tab order — is it workflow-ordered?
console.log('\n=== SK_TABS ORDER ===');
console.log(await page.evaluate(() => JSON.stringify(SK_TABS)));

// 7. Guardrail Lab: does it have "Add to blueprint"? Does it have any export-to-blueprint?
console.log('\n=== GUARD DRAWER ACTIONS ===');
console.log(await page.evaluate(async () => {
  openGuardItem(guardState.items[0].id);
  await new Promise(r=>setTimeout(r,300));
  const acts = [...document.querySelectorAll('#detailBody button, #detailBody a.btn')].map(b=>b.textContent.trim());
  const head = [...document.querySelectorAll('#detailShare button, #detailShare a')].map(b=>b.textContent.trim());
  closeDetail();
  return JSON.stringify({ body: acts, share: head }, null, 1);
}));

// 8. Coverage tab: 76 cross-links all to covAsk (copilot) — any to blueprint?
console.log('\n=== COVERAGE HANDOFF TARGETS ===');
console.log(await page.evaluate(() => {
  const pane = document.getElementById('coveragePane');
  const c = [...pane.querySelectorAll('[onclick]')].map(b=>b.getAttribute('onclick'));
  const kinds = {};
  c.forEach(o => { const m = (o.match(/([a-zA-Z_$][\w$]*)\s*\(/)||[])[1]; if(m) kinds[m]=(kinds[m]||0)+1; });
  return JSON.stringify(kinds, null, 1);
}));

console.log('\n=== ERRORS ===');
console.log(errs.length ? errs.join('\n') : 'none');
await browser.close();
