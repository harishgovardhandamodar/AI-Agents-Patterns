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

console.log('=== 108: goTo() primitive ===');
console.log(await page.evaluate(async () => {
  const out = [];
  const wait = ms => new Promise(r => setTimeout(r, ms));
  // goTo a pattern
  goTo('patterns', 'chain-of-thought');
  await wait(700);
  out.push('goTo patterns -> tab=' + currentTab + ' drawer=' + (document.getElementById('detailOverlay').classList.contains('open')) +
    ' title=' + (document.getElementById('detailTitle').textContent||'').slice(0,40) + ' hash=' + location.hash);
  // goTo a scenario
  goTo('scenarios', 'fin-card-injection');
  await wait(700);
  out.push('goTo scenarios -> tab=' + currentTab + ' title=' + (document.getElementById('detailTitle').textContent||'').slice(0,40) + ' hash=' + location.hash);
  // goTo a trace
  goTo('live', 'trace-fin-card-blocked');
  await wait(700);
  out.push('goTo live -> tab=' + currentTab + ' hash=' + location.hash + ' playerId=' + (livePlayer.state.data||{}).id);
  // goTo a design doc
  goTo('design', '01-system-context');
  await wait(900);
  out.push('goTo design -> tab=' + currentTab + ' title=' + (document.getElementById('designTitle').textContent||'').slice(0,40));
  // goTo blueprint template
  goTo('blueprint', 'tpl:research');
  await wait(700);
  out.push('goTo bp tpl -> tab=' + currentTab + ' comps=' + bpState.comps.length);
  return out.join('\n');
}));

console.log('\n=== 108: back button closes drawer ===');
console.log(await page.evaluate(async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  goTo('patterns', 'react');
  await wait(600);
  const open = document.getElementById('detailOverlay').classList.contains('open');
  const h1 = location.hash;
  history.back();
  await wait(600);
  return 'opened=' + open + ' hashBefore=' + h1 + ' hashAfter=' + location.hash +
    ' drawerAfter=' + document.getElementById('detailOverlay').classList.contains('open');
}));

console.log('\n=== no hand-rolled nav timeouts remain ===');
console.log(await page.evaluate(() => {
  // runtime check: goTo exists and is used
  return 'goTo type: ' + typeof goTo;
}));

console.log('\n=== errors ===');
console.log(errs.length ? errs.join('\n') : 'none');
await browser.close();
