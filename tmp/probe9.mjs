import puppeteer from 'puppeteer';
const URL = process.argv[2] || 'http://localhost:5199/';
const browser = await puppeteer.launch({ headless: 'shell', executablePath: process.env.CHROME_BIN, args: ['--no-sandbox','--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
const errs = [];
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });
await page.goto(URL, { waitUntil: 'networkidle2', timeout: 30000 });
await new Promise(r => setTimeout(r, 3000));

console.log('=== back button closes the drawer (iteration 108) ===');
await page.evaluate(() => { goTo('patterns', 'react'); });
await new Promise(r => setTimeout(r, 900));
const before = await page.evaluate(() => ({
  open: document.getElementById('detailOverlay').classList.contains('open'),
  hash: location.hash,
  title: document.getElementById('detailTitle').textContent
}));
console.log('before back: ' + JSON.stringify(before));

await page.goBack();
await new Promise(r => setTimeout(r, 1200));
const after = await page.evaluate(() => ({
  open: document.getElementById('detailOverlay').classList.contains('open'),
  hash: location.hash,
  tab: currentTab,
  url: location.href
}));
console.log('after back:  ' + JSON.stringify(after));

console.log('\n=== deep link survives a reload (shareable) ===');
await page.goto(URL + '#scenarios/fin-card-injection', { waitUntil: 'networkidle2' });
await new Promise(r => setTimeout(r, 3000));
const dl = await page.evaluate(() => ({
  tab: currentTab,
  open: document.getElementById('detailOverlay').classList.contains('open'),
  title: document.getElementById('detailTitle').textContent
}));
console.log(JSON.stringify(dl));

console.log('\n=== errors ===');
console.log(errs.length ? errs.join('\n') : 'none');
await browser.close();
