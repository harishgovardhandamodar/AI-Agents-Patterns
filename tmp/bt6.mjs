import puppeteer from 'puppeteer';
const browser = await puppeteer.launch({ headless: 'shell', executablePath: process.env.CHROME_BIN,
  args: ['--no-sandbox','--disable-dev-shm-usage'], protocolTimeout: 600000 });
const page = await browser.newPage();
await page.goto(process.argv[2], { waitUntil: 'networkidle2' });
await new Promise(r => setTimeout(r, 2500));
console.log(await page.evaluate(async () => {
  const cases = btCases(btDefaultConfigs().slice(0,1));
  const out = await btRun(cases, 'golden', {});
  // which assertion fails most?
  const tally = {};
  out.results.forEach(r => r.checks.forEach(c => {
    const k = c.label; tally[k] = tally[k] || {pass:0, fail:0, examples:[]};
    if (c.pass) tally[k].pass++; else { tally[k].fail++; if (tally[k].examples.length<3) tally[k].examples.push(r.scenarioId+' :: '+c.detail); }
  }));
  return JSON.stringify(tally, null, 1);
}));
await browser.close();
