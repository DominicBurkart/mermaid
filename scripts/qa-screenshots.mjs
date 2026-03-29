/**
 * QA screenshot script using Playwright.
 * Renders xychart collision test cases and saves screenshots to qa-screenshots/.
 */
import pkg from '/opt/node22/lib/node_modules/playwright/index.js';
const { chromium } = pkg;
import { readFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'qa-screenshots');
const MERMAID_JS = readFileSync(path.join(ROOT, 'packages/mermaid/dist/mermaid.js'), 'utf-8');

mkdirSync(OUT_DIR, { recursive: true });

const CHARTS = [
  {
    name: 'collision-01-steep-descent',
    diagram: `xychart
  title "Smallest AI models scoring above 60% on MMLU"
  x-axis "Date" ["Apr 2022", "Feb 2023", "Jul 2023", "Sep 2023", "Apr 2024"]
  y-axis "Parameters (B)" 0 --> 600
  line [540 "PaLM", 65 "LLaMA-65B", 34 "Llama 2 34B", 7 "Mistral 7B", 3.8 "Phi-3-mini"]`,
  },
  {
    name: 'collision-02-gentle-slope',
    diagram: `xychart
  x-axis ["A", "B", "C"]
  y-axis 0 --> 100
  line [40 "Start", 50 "Mid", 45 "End"]`,
  },
  {
    name: 'collision-03-zigzag',
    diagram: `xychart
  x-axis ["P1", "P2", "P3", "P4"]
  y-axis 0 --> 500
  line [400 "High", 50 "Low", 450 "Peak", 30 "Bottom"]`,
  },
];

const browser = await chromium.launch();
const page = await browser.newPage();

page.on('console', (msg) => {
  if (msg.type() === 'error') console.error('  BROWSER ERROR:', msg.text());
});
page.on('pageerror', (err) => console.error('  PAGE ERROR:', err.message));

await page.setViewportSize({ width: 900, height: 500 });

for (const chart of CHARTS) {
  // Navigate to a blank page so addScriptTag works
  await page.goto('about:blank');

  await page.setContent(`<!doctype html>
<html>
<head><meta charset="utf-8"/>
<style>body { margin: 20px; background: white; }</style>
</head>
<body>
<pre class="mermaid">${chart.diagram}</pre>
</body>
</html>`, { waitUntil: 'commit' });

  // Inject the mermaid UMD bundle
  await page.addScriptTag({ content: MERMAID_JS });

  // Initialize and run mermaid
  await page.evaluate(() => {
    window.mermaid.initialize({ theme: 'default', logLevel: 3, securityLevel: 'loose' });
    return window.mermaid.run();
  });

  await page.waitForTimeout(500);

  const outPath = path.join(OUT_DIR, `${chart.name}.png`);
  await page.screenshot({ path: outPath, clip: { x: 0, y: 0, width: 900, height: 500 } });
  console.log(`✓ ${chart.name}.png`);
}

await browser.close();
console.log('\nAll screenshots saved to qa-screenshots/');
