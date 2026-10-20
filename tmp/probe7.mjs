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

console.log('=== 107: NEXT engine reads all tools ===');
console.log(await page.evaluate(() => {
  const out = [];
  out.push('empty project  -> ' + JSON.stringify(wfNext().cta) + ' :: ' + wfNext().t.slice(0,80));
  // only a guardrail analysis done
  out.push('guards=' + guardState.items.length);
  const n1 = wfNext();
  out.push('with guards, no comps -> ' + n1.cta + ' :: ' + n1.t.slice(0,90));
  // add a blueprint
  bpState.comps = ['input-sanitization'];
  bpSave();
  const n2 = wfNext();
  out.push('with bp gaps -> ' + n2.cta + ' :: ' + n2.t.slice(0,90));
  // mitigation backlog with no owner
  const n3 = wfNext();
  out.push('next -> ' + n3.cta + ' :: ' + n3.t.slice(0,90));
  return out.join('\n');
}));

console.log('\n=== 117: WORKFLOW RAIL ===');
console.log(await page.evaluate(() => {
  const st = wfStatus();
  return st.stages.map(s => `${s.label.padEnd(10)} ${s.state.padEnd(7)} ${s.detail}`).join('\n');
}));

console.log('\n=== rail rendered on overview? ===');
console.log(await page.evaluate(() => {
  switchTab('overview');
  return new Promise(r => setTimeout(() => {
    const rail = document.querySelector('.dash-rail .wf-rail');
    r(rail ? 'stages: ' + rail.querySelectorAll('.wf-stage').length + ' | ' + rail.innerText.replace(/\n/g,' | ') : 'MISSING');
  }, 500));
}));

console.log('\n=== dashboard cards (should now be 6) ===');
console.log(await page.evaluate(() => {
  const cards = [...document.querySelectorAll('.dash-grid .dash-card')].map(c => c.querySelector('.dash-h').textContent.trim());
  return cards.join(' | ');
}));

console.log('\n=== errors ===');
console.log(errs.length ? errs.join('\n') : 'none');
await browser.close();
