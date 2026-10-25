import puppeteer from 'puppeteer';
const URL = process.argv[2] || 'http://localhost:5199/';
const browser = await puppeteer.launch({ headless: 'shell', executablePath: process.env.CHROME_BIN, args: ['--no-sandbox','--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000 });
const errs = [];
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });
await page.goto(URL, { waitUntil: 'networkidle2', timeout: 30000 });
await new Promise(r => setTimeout(r, 3000));

console.log('=== 1. TAB EXISTS ===');
console.log(await page.evaluate(() => {
  const t = document.querySelector('[data-tab=bench]');
  return JSON.stringify({ tab: !!t, label: t ? t.textContent.trim() : null, pane: !!document.getElementById('benchPane') });
}));

console.log('\n=== 2. PANE RENDERS ===');
await page.evaluate(() => switchTab('bench'));
await new Promise(r => setTimeout(r, 800));
console.log(await page.evaluate(() => {
  const p = document.getElementById('benchMain');
  return JSON.stringify({ html: p.innerHTML.length, configs: document.querySelectorAll('.bt-cfg').length,
    hasRunBtn: !!document.querySelector('#btAdapter'), matrix: !!document.querySelector('.bt-matrix') });
}));

console.log('\n=== 3. DIMENSION SYNC vs deploy.js ===');
console.log(await page.evaluate(() => JSON.stringify(btCheckDimSync())));

console.log('\n=== 4. CONFIG SPACE ===');
console.log(await page.evaluate(() => {
  const d = btDefaultConfigs();
  const space = btConfigSpace({ autonomy: [0,4], blast: ['service','fleet'] });
  return JSON.stringify({
    defaults: d.map(c => c.name),
    spaceSize: space.length,
    hashes: d.map(c => btConfigHash(c)),
    impliedControls: d.map(c => btConfigControlIds(c).length)
  }, null, 1);
}));

console.log('\n=== 5. CASE DERIVATION ===');
console.log(await page.evaluate(() => {
  const cases = btCases(btDefaultConfigs().slice(0,2));
  const cov = btCoverage(cases);
  return JSON.stringify({ cases: cases.length, corpus: cov.total, tested: cov.tested, pct: cov.pct, missing: cov.missing.length });
}));

console.log('\n=== 6. GUARDRAIL ADAPTER (deterministic) ===');
console.log(await page.evaluate(async () => {
  const cases = btCases(btDefaultConfigs().slice(0,1)).slice(0, 4);
  const out = await btRun(cases, 'guardrail', {});
  return JSON.stringify({
    run: out.run.summary.pass + ' pass / ' + out.run.summary.fail + ' fail / ' + out.run.summary.error + ' err / ' + out.run.summary.skip + ' skip',
    first: out.results[0] ? { scn: out.results[0].scenarioId, verdict: out.results[0].verdict,
      checks: out.results[0].checks.map(c => c.pass ? 'OK' : 'XX') } : null
  }, null, 1);
}));

console.log('\n=== 7. GOLDEN ADAPTER ===');
console.log(await page.evaluate(async () => {
  const cases = btCases([btDefaultConfigs()[0]]).filter(c => c.scenario.traceId);
  const out = await btRun(cases.slice(0,4), 'golden', {});
  return JSON.stringify({ ran: out.results.length, verdicts: out.results.map(r=>r.verdict) });
}));

console.log('\n=== 8. LIVE ADAPTER via fox-services ===');
console.log(await page.evaluate(async () => {
  const one = btCases([btDefaultConfigs()[0]]).find(c => c.scenario.id === 'fin-card-injection');
  const out = await btRun([one], 'live', { context: btContext({ mode: 'advise', maxTokens: 400 }) });
  const r = out.results[0];
  return JSON.stringify({
    verdict: r.verdict, error: r.error,
    backend: r.outcome.backend, model: r.outcome.model,
    ms: r.metrics.durationMs, chars: r.metrics.chars,
    output: (r.output||'').slice(0, 200),
    checks: r.checks.map(c => (c.pass?'OK':'XX') + ' ' + c.detail)
  }, null, 1);
}));

console.log('\n=== errors ===');
console.log(errs.length ? errs.slice(0,10).join('\n') : 'none');
await browser.close();
