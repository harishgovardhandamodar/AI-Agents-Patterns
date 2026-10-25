import puppeteer from 'puppeteer';
const browser = await puppeteer.launch({ headless: 'shell', executablePath: process.env.CHROME_BIN,
  args: ['--no-sandbox','--disable-dev-shm-usage'], protocolTimeout: 600000 });
const page = await browser.newPage();
await page.goto(process.argv[2], { waitUntil: 'networkidle2' });
await new Promise(r => setTimeout(r, 2500));
console.log(await page.evaluate(() => {
  const s = DATA.scenarios.scenarios.find(x => x.id === 'fin-card-injection');
  const cfg = btConfig(Object.assign({}, btDefaultConfigs()[0], { controls: s.patternRefs }));
  const kase = btCase(s, cfg, btContext());
  const res = btAdapter('golden').run(kase);
  const ev = btEvaluate(kase, res, { adapter: 'golden' });
  return JSON.stringify({
    verdict: ev.verdict,
    checks: ev.checks.map(c => (c.pass?'OK':'XX') + ' | ' + c.label + ' | ' + c.detail),
    outcome: res.outcome,
    metrics: res.metrics
  }, null, 1);
}));
await browser.close();
