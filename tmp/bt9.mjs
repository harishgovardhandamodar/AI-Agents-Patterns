import puppeteer from 'puppeteer';
const browser = await puppeteer.launch({ headless: 'shell', executablePath: process.env.CHROME_BIN,
  args: ['--no-sandbox','--disable-dev-shm-usage'], protocolTimeout: 600000 });
const page = await browser.newPage();
await page.goto(process.argv[2], { waitUntil: 'networkidle2' });
await new Promise(r => setTimeout(r, 2500));
console.log(await page.evaluate(async () => {
  const out = [];
  // The discrimination test: for every scenario, build a config that
  // carries that scenario's own defending controls, and one that carries
  // none. The first should pass, the second should fail.
  const base = btDefaultConfigs()[0];
  const scns = DATA.scenarios.scenarios;
  let goodPass = 0, goodFail = 0, badPass = 0, badFail = 0;
  const misses = [];
  scns.forEach(s => {
    const good = btConfig(Object.assign({}, base, { controls: s.patternRefs || [] }));
    const bad  = btConfig(Object.assign({}, base, { controls: [] }));
    const kg = btCase(s, good, btContext()), kb = btCase(s, bad, btContext());
    const rg = btAdapter('golden').run(kg), rb = btAdapter('golden').run(kb);
    const vg = btEvaluate(kg, rg, { adapter: 'golden' }).verdict;
    const vb = btEvaluate(kb, rb, { adapter: 'golden' }).verdict;
    if (vg === 'pass') goodPass++; else { goodFail++; misses.push(s.id+' :: '+btEvaluate(kg,rg,{adapter:'golden'}).checks.filter(c=>!c.pass).map(c=>c.label).join('; ')); }
    if (vb === 'fail') badFail++; else badPass++;
  });
  return JSON.stringify({
    scenarios: scns.length,
    'config carrying the defending controls -> pass': goodPass,
    'config carrying the defending controls -> fail': goodFail,
    'config carrying none -> fail': badFail,
    'config carrying none -> pass (should be ~0)': badPass,
    why_good_failed: misses.slice(0,8)
  }, null, 1);
}));
await browser.close();
