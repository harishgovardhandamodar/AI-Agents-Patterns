import puppeteer from 'puppeteer';
const URL = process.argv[2] || 'http://localhost:5199/';
const browser = await puppeteer.launch({ headless: 'shell', executablePath: process.env.CHROME_BIN, args: ['--no-sandbox','--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
const errs = [];
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });
await page.goto(URL, { waitUntil: 'networkidle2', timeout: 30000 });
await new Promise(r => setTimeout(r, 2500));

console.log('=== 103: DEPLOY -> BLUEPRINT ===');
console.log(await page.evaluate(async () => {
  const out = [];
  dpState.done = true;
  dpState.a.system = 'Stripe refunds agent';
  dpState.a.domain = 'finance';
  dpState.a.autonomy = 2; dpState.a.criticality = 'high'; dpState.a.blast = 'service';
  dpState.a.actions = ['transact','read']; dpState.a.approvalGate = true;
  dpSave();
  const ids = dpStackPatternIds();
  out.push('stack pattern ids (' + ids.length + '): ' + ids.join(', '));
  dpMaterialise('add');
  await new Promise(r=>setTimeout(r,400));
  out.push('blueprint comps: ' + bpState.comps.length + ' -> ' + bpState.comps.join(','));
  out.push('blueprint name: ' + bpState.name);
  out.push('current tab: ' + currentTab);
  return out.join('\n');
}));

console.log('\n=== 104: GUARD -> BLUEPRINT ===');
console.log(await page.evaluate(async () => {
  const out = [];
  const it = guardState.items[0];
  const mapped = guardAnalysisPatternIds(it);
  out.push('controls: ' + it.controls.length);
  it.controls.forEach(c => out.push('   ' + c.name + '  ->  ' + guardControlPatternIds(c).join(', ')));
  out.push('mapped total: ' + mapped.length + ' -> ' + mapped.join(', '));
  const before = bpState.comps.length;
  guardAddToBlueprint(it, 'add');
  await new Promise(r=>setTimeout(r,300));
  out.push('blueprint comps: ' + before + ' -> ' + bpState.comps.length);
  return out.join('\n');
}));

console.log('\n=== 105: GUARD -> LIVE VIEW ===');
console.log(await page.evaluate(async () => {
  const out = [];
  const it = guardState.items[0];
  guardPromoteToTrace(it);
  await new Promise(r=>setTimeout(r,300));
  out.push('local traces: ' + liveLocal().length);
  out.push('all traces: ' + liveAllTraces().length);
  switchTab('live');
  await new Promise(r=>setTimeout(r,500));
  out.push('trace list items: ' + document.querySelectorAll('#traceList .trace-item').length);
  const local = liveLocal()[0];
  loadTrace(local.id);
  await new Promise(r=>setTimeout(r,400));
  out.push('player loaded id: ' + (livePlayer && livePlayer.state.data ? livePlayer.state.data.id : 'none'));
  out.push('player steps: ' + (livePlayer && livePlayer.state.data ? livePlayer.state.data.steps.length : 0));
  return out.join('\n');
}));

console.log('\n=== handoff bar present in guard? ===');
console.log(await page.evaluate(() => {
  switchTab('guard');
  return new Promise(r => setTimeout(() => {
    openGuardItem(guardState.items[0].id);
    setTimeout(() => {
      const bar = document.querySelector('#guardMain .g-handoff');
      r(bar ? bar.innerText.replace(/\n/g,' | ') : 'MISSING');
    }, 300);
  }, 400));
}));

console.log('\n=== errors ===');
console.log(errs.length ? errs.join('\n') : 'none');
await browser.close();
