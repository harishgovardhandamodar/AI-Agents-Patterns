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

const tabs = ['overview','copilot','patterns','scenarios','cascades','coverage','deploy','blueprint','live','design','guard','discovery'];
console.log('=== CROSS-TOOL HANDOFFS PER TAB (accurate) ===');
for (const t of tabs) {
  const r = await page.evaluate((tab) => {
    const pane = document.getElementById(tab + 'Pane');
    if (!pane) return { tab, err: 'no pane' };
    const all = [...pane.querySelectorAll('[onclick]')];
    const cross = all.map(b => (b.getAttribute('onclick')||''))
      .filter(o => /switchTab|copilotAsk|askCopilotAbout|bpAdd|bpAddMany|bpRefsBtnHtml|bpApplyTemplate|loadTrace|openPattern|openScenario|openCascade|dlOpen|dpOpenCite|covAsk|dpAdrToCopilot|cpOpenCite|casOpenDomain|goPatternDomain|jumpToScenarioDomain/i.test(o));
    const uniq = [...new Set(cross.map(o => (o.match(/([a-zA-Z_$][\w$]*)\s*\(/)||[])[1]).filter(Boolean))];
    return { tab, total: all.length, crossCount: cross.length, fns: uniq };
  }, t);
  console.log(`${r.tab.padEnd(10)} total=${String(r.total).padEnd(4)} cross=${String(r.crossCount).padEnd(4)} fns: ${(r.fns||[]).join(', ')}`);
}

// ---- JOURNEY TEST: scenario -> blueprint -> report ----
console.log('\n=== JOURNEY: scenario protections -> blueprint -> report ===');
const j = await page.evaluate(async () => {
  const log = [];
  // open a scenario
  const scn = DATA.scenarios.scenarios.find(s => (s.patternRefs||[]).length >= 2);
  log.push('scenario: ' + scn.id + ' patternRefs=' + (scn.patternRefs||[]).length);
  openScenario(scn.id);
  await new Promise(r => setTimeout(r, 300));
  const acts = [...document.querySelectorAll('#detailBody button, #detailBody a.btn')].map(b=>b.textContent.trim());
  log.push('drawer actions: ' + JSON.stringify(acts));
  // click "Add N linked patterns"
  const addBtn = [...document.querySelectorAll('#detailBody button')].find(b=>/Add \d+ linked/.test(b.textContent));
  log.push('found add-linked button: ' + !!addBtn);
  if (addBtn) {
    addBtn.click();
    await new Promise(r => setTimeout(r, 400));
    log.push('blueprint comps after click: ' + bpState.comps.length + ' -> ' + JSON.stringify(bpState.comps));
  }
  // now the deploy -> blueprint claim
  log.push('dpState.done: ' + dpState.done);
  // guardrail collection -> any blueprint handoff?
  log.push('guard items: ' + guardState.items.length);
  return log;
});
j.forEach(l => console.log('  ' + l));

// ---- REPORT CONTENT COVERAGE ----
console.log('\n=== REPORT: what does it include? ===');
const rep = await page.evaluate(() => {
  const md = rpMarkdown();
  return {
    sections: md.split('\n').filter(l=>l.startsWith('## ')),
    hasGuardrail: /guardrail lab|guardrail analysis/i.test(md),
    hasMitigation: /mitigation backlog/i.test(md),
    hasDiscovery: /discovery/i.test(md),
    hasPins: /working set|pinned/i.test(md),
    hasCascades: /cascade/i.test(md),
    len: md.length
  };
});
console.log(JSON.stringify(rep, null, 1));

// ---- "Next:" suggestion chain ----
console.log('\n=== DASH NEXT (the workflow spine) ===');
const nx = await page.evaluate(() => { const n = dashNext(); return n; });
console.log(JSON.stringify(nx, null, 1));

console.log('\n=== PAGE ERRORS ===');
console.log(errs.length ? errs.join('\n') : 'none');
await browser.close();
