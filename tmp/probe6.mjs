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

console.log('=== REPORT v2 sections + coverage ===');
console.log(await page.evaluate(() => {
  // set up work in every tool
  dpState.done = true; dpState.a.system = 'Stripe refunds agent';
  bpState.name = 'Stripe refunds agent'; bpState.comps = ['input-sanitization','approval-gates'];
  guardState.items = [guardState.items[0]];
  pinState.patterns = ['input-sanitization','policy-engine'];
  // mitigation owner/status
  const b = buildMitigationBacklog();
  if (b[0]) { mitSet(b[0].key, 'owner', 'j.mercer'); mitSet(b[0].key, 'status', 'in progress'); }
  const md = rpMarkdown();
  return JSON.stringify({
    sections: md.split('\n').filter(l=>l.startsWith('## ')),
    hasGuardrail: /## 3\. Guardrail analyses/.test(md),
    hasMitigation: /## 4\. Cascade mitigation backlog/.test(md),
    hasPins: /## 5\. Working set/.test(md),
    hasDiscovery: /## 6\. Discovery drafts/.test(md),
    hasCopilot: /## 7\. Fox - Architect consult/.test(md),
    coversLine: (md.match(/\*\*Covers:\*\*.*/)||[])[0],
    ownerInReport: /j\.mercer/.test(md),
    projectName: rpProjectName(),
    len: md.length
  }, null, 1);
}));

console.log('\n=== JSON export shape ===');
console.log(await page.evaluate(() => {
  const j = JSON.parse(rpJson());
  return JSON.stringify(Object.keys(j), null, 1) + '\nguardrails: ' + (j.guardrails ? j.guardrails.length : null) +
    '\nmitigationBacklog: ' + (j.mitigationBacklog ? j.mitigationBacklog.length : null) +
    '\nworkingSet: ' + (j.workingSet ? JSON.stringify(j.workingSet) : null) +
    '\nproject: ' + j.project;
}));

console.log('\n=== print HTML renders ===');
console.log(await page.evaluate(() => {
  const md = rpMarkdown();
  const html = rpHtml(md);
  return JSON.stringify({ len: html.length, tables: (html.match(/<table>/g)||[]).length, h2: (html.match(/<h2>/g)||[]).length });
}));

console.log('\n=== errors ===');
console.log(errs.length ? errs.join('\n') : 'none');
await browser.close();
