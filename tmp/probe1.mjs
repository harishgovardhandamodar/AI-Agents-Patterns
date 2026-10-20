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

// ---- 1. Workflow: does the app have a single "project" concept? ----
const probe = await page.evaluate(() => {
  const out = {};
  // count global state objects
  out.globals = Object.keys(window).filter(k => /^(bp|dp|cp|guard|disc|pin|ui|ux|cas|pat|scn|data)/i.test(k) && typeof window[k] !== 'function');
  // does any UI expose "project / workspace / engagement"?
  out.hasProjectConcept = /project|workspace|engagement/i.test(document.body.innerText);
  // what does the deploy intake collect?
  return out;
});
console.log('=== GLOBALS ===');
console.log(JSON.stringify(probe, null, 1));

// ---- 2. Cross-tab handoff inventory: what buttons exist in each pane ----
const tabs = ['overview','copilot','patterns','scenarios','cascades','coverage','deploy','blueprint','live','design','guard','discovery'];
console.log('\n=== PER-TAB: action buttons + handoff targets ===');
for (const t of tabs) {
  const r = await page.evaluate((tab) => {
    const pane = document.getElementById(tab + 'Pane');
    if (!pane) return { tab, err: 'no pane' };
    const btns = [...pane.querySelectorAll('button, a.btn, [onclick]')];
    const texts = btns.map(b => (b.textContent||'').trim().replace(/\s+/g,' ')).filter(Boolean);
    const onclicks = btns.map(b => (b.getAttribute('onclick')||'')).filter(Boolean);
    const switches = onclicks.filter(o => /switchTab|dlOpen|copilotAsk|askCopilot|bpAdd|loadTrace|openPattern|openScenario|openCascade/.test(o));
    return { tab, btnCount: btns.length, switches: switches.slice(0, 6) };
  }, t);
  console.log(`${r.tab}: ${r.btnCount} buttons | cross-links: ${r.switches.length}`);
  r.switches.slice(0,3).forEach(s => console.log('    ' + s.slice(0,150)));
}

console.log('\n=== PAGE ERRORS ===');
console.log(errs.length ? errs.join('\n') : 'none');
await browser.close();
