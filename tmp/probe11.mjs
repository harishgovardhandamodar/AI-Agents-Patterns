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

console.log('=== 114: saved research sets ===');
console.log(await page.evaluate(async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const out = [];
  switchTab('patterns');
  await wait(400);
  // set a filter
  patState.cats.clear(); patState.cats.add('safety');
  patState.domains.clear(); patState.domains.add('finance');
  el('patSearch').value = 'budget';
  renderPatterns();
  const n = resSave('patterns', 'Unprotected finance budget controls');
  out.push('saved: ' + (n ? n.id + ' / ' + n.name : 'FAILED'));
  out.push('bar html: ' + (document.getElementById('patResSets')||{}).innerHTML.slice(0,150));
  // change the filter
  patState.cats.clear(); patState.cats.add('resilience');
  renderPatterns();
  out.push('after change, cats=' + [...patState.cats].join(','));
  // apply the set
  resApply(n.id);
  await wait(700);
  out.push('after apply, cats=' + [...patState.cats].join(',') + ' domains=' + [...patState.domains].join(',') + ' q=' + el('patSearch').value);
  return out.join('\n');
}));

console.log('\n=== 116: multi-select preview ===');
console.log(await page.evaluate(async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const out = [];
  switchTab('blueprint');
  await wait(500);
  bpState.comps = ['input-sanitization']; bpSave(); bpRenderPalette();
  bpSelToggle('approval-gates');
  bpSelToggle('audit-trail');
  bpSelToggle('input-sanitization');   // already on canvas
  await wait(200);
  const p = bpSelPreview();
  out.push('selected=' + p.ids.length + ' fresh=' + p.fresh.length + ' already=' + p.already);
  out.push('closes: ' + p.closes.join(', '));
  const bar = document.getElementById('bpSelBar');
  out.push('bar: ' + (bar ? bar.innerText.replace(/\n/g,' | ') : 'MISSING'));
  const before = bpState.comps.length;
  bpSelAdd();
  await wait(300);
  out.push('comps ' + before + ' -> ' + bpState.comps.length);
  out.push('sel cleared: ' + (bpSel.ids.size === 0));
  return out.join('\n');
}));

console.log('\n=== 118: palette v3 ===');
console.log(await page.evaluate(async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const out = [];
  const cmds = palDynamicCommands();
  out.push('dynamic commands (' + cmds.length + '):');
  cmds.forEach(c => out.push('   ' + c.id + ' :: ' + c.title));
  // search
  const hits = palSearch('next');
  out.push('search "next": ' + hits.slice(0,3).map(h=>h.it.title).join(' | '));
  const hits2 = palSearch('stage:');
  out.push('search "stage:": ' + hits2.length + ' hits');
  const hits3 = palSearch('proj:');
  out.push('search "proj:": ' + hits3.length + ' hits');
  // projects + research sets in the index
  const items = palBuild();
  out.push('palette items: projects=' + items.filter(i=>i.kind==='project').length + ' ressets=' + items.filter(i=>i.kind==='resset').length);
  return out.join('\n');
}));

console.log('\n=== errors ===');
console.log(errs.length ? errs.join('\n') : 'none');
await browser.close();
