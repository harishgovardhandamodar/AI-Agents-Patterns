import puppeteer from 'puppeteer';
const browser = await puppeteer.launch({ headless: 'shell', executablePath: process.env.CHROME_BIN,
  args: ['--no-sandbox','--disable-dev-shm-usage'], protocolTimeout: 600000 });
const page = await browser.newPage();
await page.goto(process.argv[2], { waitUntil: 'networkidle2' });
await new Promise(r => setTimeout(r, 2500));
console.log(await page.evaluate(() => {
  // Is the "control-present" failure a real signal? Compare the implied
  // stack against a config that carries the scenario's own patternRefs.
  const s = DATA.scenarios.scenarios.find(x => x.id === 'fin-card-injection');
  const cfg = btDefaultConfigs()[0];
  const implied = btConfigControlIds(cfg);
  const refs = s.patternRefs;
  return JSON.stringify({
    scenario: s.id,
    scenarioRefs: refs,
    impliedControls: implied,
    overlap: refs.filter(r => implied.includes(r)),
    overlapPct: Math.round(refs.filter(r => implied.includes(r)).length / refs.length * 100),
    // A config that pins the scenario's own refs:
    pinnedConfigPct: 100,
    // The point: the *same* scenario passes when the subject carries the
    // controls that defend it.
    verdictImplied: (function () {
      const kase = btCase(s, cfg, btContext());
      const res = btAdapter('golden').run(kase);
      return btEvaluate(kase, res, { adapter: 'golden' }).verdict;
    })(),
    verdictPinned: (function () {
      const c2 = btConfig(Object.assign({}, cfg, { controls: refs }));
      const kase = btCase(s, c2, btContext());
      const res = btAdapter('golden').run(kase);
      return btEvaluate(kase, res, { adapter: 'golden' }).verdict;
    })()
  }, null, 1);
}));
await browser.close();
