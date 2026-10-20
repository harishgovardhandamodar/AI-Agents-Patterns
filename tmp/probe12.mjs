import puppeteer from 'puppeteer';
const URL = process.argv[2] || 'http://localhost:5199/';
const browser = await puppeteer.launch({ headless: 'shell', executablePath: process.env.CHROME_BIN, args: ['--no-sandbox','--disable-dev-shm-usage'] });
const page = await browser.newPage();
const errs = [];
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });

const TABS = ['overview','copilot','patterns','scenarios','cascades','coverage','deploy','blueprint','live','design','guard','discovery'];
const WIDTHS = [1920, 1600, 1440, 1366, 1280, 1152, 1024, 900, 820, 768, 600, 390, 360];
let problems = [];

console.log('=== WIDTH SWEEP: horizontal overflow + errors ===');
for (const w of WIDTHS) {
  await page.setViewport({ width: w, height: 900 });
  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 1800));
  for (const t of TABS) {
    await page.evaluate((tab) => switchTab(tab), t);
    await new Promise(r => setTimeout(r, 260));
    const of = await page.evaluate(() => {
      const de = document.documentElement;
      const overflow = de.scrollWidth - de.clientWidth;
      // find the widest offending element
      let worst = null, worstW = 0;
      document.querySelectorAll('#maincontent *').forEach(el => {
        const r = el.getBoundingClientRect();
        if (r.right > de.clientWidth + 2 && r.width > worstW) { worstW = r.width; worst = el.tagName + '.' + (el.className||'').toString().split(' ')[0]; }
      });
      return { overflow, worst };
    });
    if (of.overflow > 2) problems.push(`${w}px ${t}: overflow ${of.overflow}px (${of.worst})`);
  }
  process.stdout.write(`${w}px `);
}
console.log('\n');

console.log('=== A11Y / SEMANTICS ===');
await page.setViewport({ width: 1440, height: 900 });
await page.goto(URL, { waitUntil: 'networkidle2' });
await new Promise(r => setTimeout(r, 2500));
const a11y = await page.evaluate(() => {
  const out = {};
  out.main = document.querySelectorAll('main#maincontent').length;
  out.nestedMain = document.querySelectorAll('main main').length;
  out.tabs = document.querySelectorAll('[role=tab]').length;
  out.ariaSelected = document.querySelectorAll('[role=tab][aria-selected]').length;
  out.unlabelled = [...document.querySelectorAll('input,select,textarea')].filter(el => {
    if (el.type === 'hidden') return false;
    return !(el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.closest('label') ||
      (el.id && document.querySelector('label[for="' + el.id + '"]')));
  }).map(el => el.id || el.tagName + '.' + (el.className||''));
  out.liveRegions = document.querySelectorAll('[aria-live],[role=status],[role=log]').length;
  out.buttonsNoName = [...document.querySelectorAll('button')].filter(b =>
    !b.textContent.trim() && !b.getAttribute('aria-label') && !b.getAttribute('title')).length;
  // citations are real links
  out.citeLinks = document.querySelectorAll('a.cp-cite').length;
  out.citeSpans = document.querySelectorAll('span.cp-cite').length;
  // workflow rail
  out.rail = document.querySelectorAll('.wf-rail .wf-stage').length;
  // project chip
  out.projChip = !!document.getElementById('projChip');
  return out;
});
console.log(JSON.stringify(a11y, null, 1));

console.log('\n=== console/page errors across the sweep ===');
console.log(errs.length ? errs.slice(0,20).join('\n') : 'none');

console.log('\n=== overflow problems ===');
console.log(problems.length ? problems.join('\n') : 'none');

await browser.close();
