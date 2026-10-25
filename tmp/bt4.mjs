import puppeteer from 'puppeteer';
const URL = process.argv[2] || 'http://localhost:5199/';
const browser = await puppeteer.launch({ headless: 'shell', executablePath: process.env.CHROME_BIN,
  args: ['--no-sandbox','--disable-dev-shm-usage'], protocolTimeout: 600000 });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000 });
const errs = [];
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
await page.goto(URL, { waitUntil: 'networkidle2', timeout: 30000 });
await new Promise(r => setTimeout(r, 3000));

console.log('=== LIVE ADAPTER: axiom, tightened prompt ===');
console.log(await page.evaluate(async () => {
  const one = btCases([btDefaultConfigs()[0]]).find(c => c.scenario.id === 'fin-card-injection');
  const ctx = btContext({ mode: 'advise', maxTokens: 3000, backend: 'axiom', maxWords: 220 });
  const out = await btRun([one], 'live', { context: ctx });
  const r = out.results[0];
  return JSON.stringify({
    verdict: r.verdict, error: r.error,
    backend: r.outcome.backend, model: r.outcome.model, attempts: r.outcome.attempts,
    ms: r.metrics.durationMs, chars: r.metrics.chars,
    output: (r.output||'').slice(0, 700),
    checks: r.checks.map(c => (c.pass?'OK':'XX') + ' ' + c.label + ' :: ' + c.detail)
  }, null, 1);
}));

console.log('\n=== ACT MODE (axiom) ===');
console.log(await page.evaluate(async () => {
  const one = btCases([btDefaultConfigs()[0]]).find(c => c.scenario.id === 'selfrewrite-reward-hack');
  const ctx = btContext({ mode: 'act', maxTokens: 3000, backend: 'axiom', maxWords: 200 });
  const out = await btRun([one], 'live', { context: ctx });
  const r = out.results[0];
  return JSON.stringify({
    scenario: r.scenarioId, verdict: r.verdict, error: r.error,
    backend: r.outcome.backend, ms: r.metrics.durationMs, chars: r.metrics.chars,
    output: (r.output||'').slice(0, 500),
    checks: r.checks.map(c => (c.pass?'OK':'XX') + ' ' + c.label + ' :: ' + c.detail)
  }, null, 1);
}));

console.log('\n=== errors ===');
console.log(errs.length ? errs.join('\n') : 'none');
await browser.close();
