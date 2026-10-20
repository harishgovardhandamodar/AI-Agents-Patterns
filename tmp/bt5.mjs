import puppeteer from 'puppeteer';
const URL = process.argv[2] || 'http://localhost:5199/';
const browser = await puppeteer.launch({ headless: 'shell', executablePath: process.env.CHROME_BIN,
  args: ['--no-sandbox','--disable-dev-shm-usage'], protocolTimeout: 600000 });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000 });
const errs = [];
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });
await page.goto(URL, { waitUntil: 'networkidle2', timeout: 30000 });
await new Promise(r => setTimeout(r, 3000));

console.log('=== CORPUS: all 54 scenarios replayable? ===');
console.log(await page.evaluate(() => {
  const S = DATA.scenarios.scenarios, T = DATA.traces.traces;
  const noTrace = S.filter(s => !s.traceId);
  return JSON.stringify({ scenarios: S.length, traces: T.length, withoutTrace: noTrace.length,
    traceIdsResolve: S.every(s => !s.traceId || T.some(t => t.id === s.traceId)) });
}));

console.log('\n=== a generated trace renders in the Live View ===');
console.log(await page.evaluate(async () => {
  switchTab('live');
  await new Promise(r => setTimeout(r, 700));
  const t = DATA.traces.traces.find(x => x.id === 'trace-selfrewrite-reward-hack');
  loadTrace(t.id);
  await new Promise(r => setTimeout(r, 700));
  const svg = document.querySelector('#livePlayer svg');
  return JSON.stringify({
    loaded: livePlayer && livePlayer.state.data ? livePlayer.state.data.id : null,
    steps: livePlayer.state.data.steps.length,
    diagramRendered: !!svg,
    diagramNodes: svg ? svg.querySelectorAll('.node').length : 0,
    events: (livePlayer.state.data.events||[]).length
  });
}));

console.log('\n=== BENCH over the full corpus, deterministic adapter ===');
console.log(await page.evaluate(async () => {
  const t0 = Date.now();
  const cases = btCases(btDefaultConfigs().slice(0,2));
  const out = await btRun(cases, 'guardrail', {});
  const s = out.run.summary;
  return JSON.stringify({
    cases: cases.length, ms: Date.now()-t0,
    pass: s.pass, fail: s.fail, error: s.error, skip: s.skip, passPct: s.passPct,
    bySeverity: s.bySeverity,
    coverage: out.run.coverage.tested + '/' + out.run.coverage.total,
    byConfig: s.byConfig
  }, null, 1);
}));

console.log('\n=== BENCH over the full corpus, golden adapter ===');
console.log(await page.evaluate(async () => {
  const cases = btCases(btDefaultConfigs().slice(0,1));
  const out = await btRun(cases, 'golden', {});
  const s = out.run.summary;
  return JSON.stringify({ cases: cases.length, pass: s.pass, fail: s.fail, error: s.error, skip: s.skip });
}));

console.log('\n=== errors ===');
console.log(errs.length ? errs.slice(0,8).join('\n') : 'none');
await browser.close();
