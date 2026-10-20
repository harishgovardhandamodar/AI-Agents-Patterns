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

console.log('=== chip present? ===');
console.log(await page.evaluate(() => {
  const c = document.getElementById('projChip');
  return JSON.stringify({ chip: !!c, name: c ? c.textContent.trim() : null, projects: projAll().length, active: projActiveId() });
}));

console.log('\n=== workflow: set blueprint name, switch project, come back ===');
console.log(await page.evaluate(async () => {
  const out = [];
  bpState.name = 'Stripe refunds agent';
  bpState.comps = ['input-sanitization','approval-gates'];
  bpSave();
  out.push('bp set: ' + bpState.name + ' / ' + bpState.comps.length);
  // create + switch to a new project
  const p = projEnsure('ACME corp');
  projSwitch(p.id);
  await new Promise(r=>setTimeout(r,200));
  out.push('after switch bp: "' + bpState.name + '" comps=' + bpState.comps.length);
  out.push('project list: ' + projAll().map(x=>x.name).join(' | '));
  // switch back
  const first = projAll()[0];
  projSwitch(first.id);
  await new Promise(r=>setTimeout(r,200));
  out.push('after switch back bp: "' + bpState.name + '" comps=' + bpState.comps.length);
  return out.join('\n');
}));

console.log('\n=== panel renders? ===');
console.log(await page.evaluate(() => {
  projPanelToggle(true);
  const p = document.getElementById('projPanel');
  return JSON.stringify({ open: p.classList.contains('open'), rows: p.querySelectorAll('.proj-row').length, html: p.innerHTML.length });
}));

console.log('\n=== errors ===');
console.log(errs.length ? errs.join('\n') : 'none');
await browser.close();
