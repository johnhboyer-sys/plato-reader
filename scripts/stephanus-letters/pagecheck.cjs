const { chromium } = require("/Users/johnboyer/Developer/aristotle-plates-scratch/pw/node_modules/playwright-core");
(async () => {
  const b = await chromium.launch({ executablePath: "/Users/johnboyer/Library/Caches/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell" });
  for (const w of [1200, 375]) {
    const p = await b.newPage({ viewport: { width: w, height: 900 } });
    const errs = []; p.on("pageerror", e => errs.push(e.message));
    await p.goto("file:///Users/johnboyer/Developer/plato-reader/build/stephanus-letters/review.html");
    const r = await p.evaluate(() => ({
      cards: document.querySelectorAll("article.row").length,
      now: document.querySelectorAll(".m.now").length, opus: document.querySelectorAll(".m.new").length,
      grok: document.querySelectorAll(".gk").length, agree: document.querySelectorAll(".gk.agree").length,
      h2: [...document.querySelectorAll("h2")].map(h => h.textContent),
      overflow: document.documentElement.scrollWidth > innerWidth,
      tally: document.getElementById("tally").textContent }));
    console.log(w, JSON.stringify(r), errs);
  }
  await b.close();
})();
