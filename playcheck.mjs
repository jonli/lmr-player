// Henry's playback check: plays each new LMR clip on our real player page, like a fan's phone does,
// and records whether YouTube lets it play here. Results go to results.json; Supabase reads them hourly.
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const SUPABASE = 'https://vpvsqfbhaigxnkqydnqc.supabase.co';
const KEY = 'sb_publishable_EZ32-EmLYlETo-DwG7N3EQ_p-DS3m8c'; // public key, same one the app ships with
const PAGE = 'https://jonli.github.io/lmr-player/';

const q = await fetch(`${SUPABASE}/rest/v1/rpc/henry_playcheck_queue`, {
  method: 'POST',
  headers: { apikey: KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({ p_limit: 60 }),
});
if (!q.ok) throw new Error(`queue: HTTP ${q.status}`);
const ids = (await q.json()).map((r) => (typeof r === 'string' ? r : Object.values(r)[0]));
console.log(`checking ${ids.length} clips`);

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const context = await browser.newContext();
await context.addInitScript(() => {
  window.__ev = [];
  window.LMR = { onEvent: (t, d) => window.__ev.push(t + ':' + d) };
});

const fresh = [];
for (const id of ids) {
  const page = await context.newPage();
  let result = 'timeout';
  try {
    await page.goto(`${PAGE}?v=${id}&autoplay=1`, { waitUntil: 'domcontentloaded', timeout: 20000 });
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const ev = await page.evaluate(() => window.__ev);
      const err = ev.find((e) => e.startsWith('error:'));
      if (err) { result = err; break; }
      if (ev.includes('state:1')) { result = 'ok'; break; }
      await page.waitForTimeout(500);
    }
  } catch (e) {
    result = 'timeout';
  }
  await page.close();
  console.log(id, result);
  fresh.push({ id, result, at: new Date().toISOString() });
}
await browser.close();

// Keep the last 1,000 results, newest first.
const old = existsSync('results.json') ? JSON.parse(readFileSync('results.json', 'utf8')).results || [] : [];
const seen = new Set(fresh.map((r) => r.id));
const results = [...fresh, ...old.filter((r) => !seen.has(r.id))].slice(0, 1000);
writeFileSync('results.json', JSON.stringify({ updated: new Date().toISOString(), results }, null, 1) + '\n');
