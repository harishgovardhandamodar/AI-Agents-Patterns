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

console.log('=== 109: deep links for work products ===');
console.log(await page.evaluate(async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const out = [];
  // blueprint current
  goTo('blueprint', 'current'); await wait(600);
  out.push('blueprint/current -> tab=' + currentTab + ' hash=' + location.hash);
  // deploy plan
  goTo('deploy', 'plan'); await wait(600);
  out.push('deploy/plan -> tab=' + currentTab + ' hash=' + location.hash);
  // discovery run
  goTo('discovery', 'run'); await wait(600);
  out.push('discovery/run -> tab=' + currentTab + ' hash=' + location.hash);
  // project
  goTo('overview', 'proj:' + projActiveId()); await wait(600);
  out.push('overview/proj -> tab=' + currentTab + ' hash=' + location.hash);
  // library entry
  bpState.lib = [{name:'Test bp', comps:['react'], notes:'', at: Date.now()}]; bpSaveLib();
  goTo('blueprint', 'lib:0'); await wait(600);
  out.push('blueprint/lib:0 -> tab=' + currentTab + ' comps=' + bpState.comps.length);
  return out.join('\n');
}));

console.log('\n=== 110: ask sends the artifact ===');
console.log(await page.evaluate(() => {
  const out = [];
  // capture what would be sent
  const orig = window.copilotAsk;
  let sent = null;
  window.copilotAsk = function(q) { sent = q; };
  askAbout('pattern', 'chain-of-thought');
  out.push('PATTERN query (' + sent.length + ' chars): ' + sent.slice(0, 150) + '...');
  sent = null;
  askAbout('scenario', 'fin-card-injection');
  out.push('SCENARIO query (' + sent.length + ' chars): ' + sent.slice(0, 150) + '...');
  sent = null;
  askAbout('cascade', 'cas-cas-credential-compromise-across-tenants');
  out.push('CASCADE query (' + sent.length + ' chars): ' + sent.slice(0, 150) + '...');
  sent = null;
  askAboutGuard(guardState.items[0]);
  out.push('GUARD query (' + sent.length + ' chars): ' + sent.slice(0, 150) + '...');
  window.copilotAsk = orig;
  return out.join('\n');
}));

console.log('\n=== 111: citations are real links ===');
console.log(await page.evaluate(async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  cpMessages.push({role:'assistant', content:'See the catalog.', cites:[{kind:'pattern',id:'chain-of-thought',label:'Chain-of-Thought'},{kind:'scenario',id:'fin-card-injection',label:'Card injection'}]});
  cpRenderLog();
  await wait(300);
  const cites = [...document.querySelectorAll('.cp-cites .cp-cite')];
  return cites.map(c => `${c.tagName} href="${c.getAttribute('href')}" focusable=${c.tabIndex>=0||c.tagName==='A'}`).join('\n');
}));

console.log('\n=== landing citations ===');
console.log(await page.evaluate(() => {
  const links = [...document.querySelectorAll('#ovLanding a.cp-cite')];
  return 'count=' + links.length + '\n' + links.slice(0,3).map(l => `${l.tagName} ${l.getAttribute('href')}`).join('\n');
}));

console.log('\n=== errors ===');
console.log(errs.length ? errs.join('\n') : 'none');
await browser.close();
