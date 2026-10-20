import puppeteer from 'puppeteer';
const URL = process.argv[2] || 'http://localhost:5199/';
const browser = await puppeteer.launch({ headless: 'shell', executablePath: process.env.CHROME_BIN, args: ['--no-sandbox','--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
const errs = [];
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
await page.goto(URL, { waitUntil: 'networkidle2', timeout: 30000 });
await new Promise(r => setTimeout(r, 2500));

console.log('=== BATTLE-TEST GAP ANALYSIS ===');
console.log(await page.evaluate(() => {
  const out = [];
  const S = DATA.scenarios.scenarios, T = DATA.traces.traces, C = DATA.cascades.cascades, P = DATA.patterns.patterns;

  // 1. Can we execute ANY agent? (the core of battle testing)
  out.push('1. EXECUTION: is there any way to run an agent against a scenario?');
  out.push('   LLM.chat exists: ' + (typeof LLM !== 'undefined' && typeof LLM.chat === 'function'));
  out.push('   Any eval/runner/battle/harness function: ' +
    (Object.keys(window).filter(k => /eval|battle|harness|runner|probe|adversar/i.test(k)).join(',') || 'NONE'));

  // 2. Scenario -> trace coverage
  const traced = new Set(S.filter(s => s.traceId).map(s => s.traceId));
  const untraced = S.filter(s => !s.traceId);
  out.push('');
  out.push('2. SCENARIO COVERAGE: ' + S.length + ' scenarios, ' + (S.length - untraced.length) + ' with a trace, ' + untraced.length + ' WITHOUT');
  out.push('   untraced: ' + untraced.map(s => s.id).join(', '));

  // 3. Are the traces useful as a TEST BENCH? (do they have assertions?)
  const withAssert = T.filter(t => t.assert || t.assertions || t.expect || t.checks).length;
  out.push('');
  out.push('3. TEST BENCH QUALITY:');
  out.push('   traces with assertions/checks: ' + withAssert + '/' + T.length);
  out.push('   traces with a passing/failing outcome per step: ' + T.filter(t => t.steps.some(s => s.expected)).length);
  out.push('   any pass/fail field on a trace: ' + (T.filter(t => t.result || t.outcome || t.score !== undefined).length));

  // 4. Configuration dimensions
  out.push('');
  out.push('4. CONFIGURATION: the planner knows these, but can they be replayed?');
  out.push('   autonomy levels: 5 · actions: 7 · blast radii: 7 · data classes: 5');
  out.push('   dpStack() derives a stack per config: ' + (typeof dpStack === 'function'));
  out.push('   BUT: is there any (scenario x config) matrix? ' +
    (Object.keys(window).filter(k => /matrix|grid|sweep|comb/i.test(k)).join(',') || 'NONE'));

  // 5. Cascade coverage of scenarios
  const casWithScn = C.filter(c => (c.scenarioRefs||[]).length);
  out.push('');
  out.push('5. CASCADES: ' + C.length + ' total, ' + casWithScn.length + ' reference a scenario');
  out.push('   cascades per scenario (avg): ' + (C.reduce((a,c)=>a+(c.scenarioRefs||[]).length,0)/S.length).toFixed(1));

  // 6. Patterns: can they be used as controls in a test?
  out.push('');
  out.push('6. CONTROLS: patterns have protections, but no "is this control active?" check');
  const withProt = P.filter(p => (p.protections||[]).length).length;
  out.push('   patterns with protections: ' + withProt + '/' + P.length);

  // 7. What can a battle-test actually assert today?
  out.push('');
  out.push('7. ASSERTABLE SURFACE today:');
  out.push('   scenario.protections: ' + Object.keys(S[0]).join(', '));
  out.push('   trace.metrics: ' + Object.keys(T[0].metrics).join(', '));

  return out.join('\n');
}));

console.log('\n=== errors ===');
console.log(errs.length ? errs.join('\n') : 'none');
await browser.close();
