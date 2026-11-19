const { chromium } = require('/Users/johnboyer/Developer/aristotle-plates-scratch/pw/node_modules/playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: '/Users/johnboyer/Library/Caches/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell' });
  const p = await b.newPage(); const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.goto('file:///Users/johnboyer/Developer/plato-reader/build/stephanus-letters/review.html');
  const w = p.locator('.w').nth(5); const word = await w.textContent();
  await w.click();
  const shown = await p.evaluate(() => !document.getElementById('pop').hidden);
  const txt = await p.locator('#pop').innerText();
  await p.mouse.click(5, 5);
  const closed = await p.evaluate(() => document.getElementById('pop').hidden);
  const missing = await p.evaluate(() => [...document.querySelectorAll('.w')].filter(e => !AN[e.dataset.k]).length);
  console.log(JSON.stringify({ word, shown, txt, closed, missing, errs }));
  await b.close();
})();
