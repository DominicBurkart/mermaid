/**
 * Playwright QA script for PR #1: xychart per-point text labels
 * Starts the dev server, renders xychart.html, takes screenshots, runs assertions.
 */

import { chromium } from 'playwright';
import { spawn } from 'child_process';
import { mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const PORT = 9001; // use 9001 to avoid conflicts
const BASE_URL = `http://localhost:${PORT}`;
const SCREENSHOTS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'qa-screenshots');

mkdirSync(SCREENSHOTS_DIR, { recursive: true });

// ── helpers ────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function check(name, ok, detail = '') {
  if (ok) {
    console.log(`  ✓ ${name}`);
    passed++;
  } else {
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

async function waitForServer(url, timeoutMs = 30_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Server never became ready at ${url}`);
}

// ── start dev server ───────────────────────────────────────────────────────

console.log('Starting dev server on port', PORT, '...');
const server = spawn('pnpm', ['dev'], {
  env: { ...process.env, MERMAID_PORT: String(PORT) },
  cwd: path.join(path.dirname(fileURLToPath(import.meta.url)), '..'),
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stdout.on('data', () => {}); // drain
server.stderr.on('data', () => {});

await waitForServer(BASE_URL);
console.log('Server ready.\n');

// ── launch browser ─────────────────────────────────────────────────────────

const browser = await chromium.launch({
  headless: true,
  executablePath: '/root/.cache/ms-playwright/chromium-1194/chrome-linux/chrome',
});
const page = await browser.newPage();
page.setDefaultTimeout(15_000);

// collect console errors from mermaid
const consoleErrors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
});

await page.goto(`${BASE_URL}/xychart.html`);

// wait for all mermaid diagrams to render (pre.mermaid → svg)
await page.waitForFunction(() => {
  const svgs = document.querySelectorAll('svg');
  return svgs.length >= 20; // demo has 21 diagrams
}, { timeout: 20_000 });

// extra settle time for fonts / layout
await page.waitForTimeout(500);

// ── helper: find SVG that follows the given h1 text ───────────────────────

async function getSvgAfterHeading(headingText) {
  return page.evaluateHandle((text) => {
    const headings = [...document.querySelectorAll('h1')];
    const h = headings.find((el) => el.textContent.trim() === text);
    if (!h) return null;
    // walk siblings until we find an svg
    let el = h.nextElementSibling;
    while (el) {
      const svg = el.tagName === 'svg' ? el : el.querySelector('svg');
      if (svg) return svg;
      el = el.nextElementSibling;
    }
    return null;
  }, headingText);
}

async function svgTextContent(svgHandle) {
  return page.evaluate((svg) => {
    if (!svg) return [];
    return [...svg.querySelectorAll('text')].map((t) => ({
      text: t.textContent.trim(),
      fill: t.getAttribute('fill') || t.style.fill || '',
      x: parseFloat(t.getAttribute('x') || '0'),
      y: parseFloat(t.getAttribute('y') || '0'),
    }));
  }, svgHandle);
}

async function svgLinePaths(svgHandle) {
  return page.evaluate((svg) => {
    if (!svg) return [];
    return [...svg.querySelectorAll('path')].map((p) => ({
      stroke: p.getAttribute('stroke') || p.style.stroke || '',
    }));
  }, svgHandle);
}

// ── screenshot helpers ─────────────────────────────────────────────────────

async function screenshotSection(heading, filename) {
  // scroll the heading into view first
  await page.evaluate((text) => {
    const h = [...document.querySelectorAll('h1')].find((el) => el.textContent.trim() === text);
    if (h) h.scrollIntoView({ block: 'start' });
  }, heading);
  await page.waitForTimeout(150);

  const h1 = page.locator('h1').filter({ hasText: heading }).first();
  const box = await h1.boundingBox();
  if (!box) return;

  // find adjacent svg bounding rect (after scroll, so it's in viewport)
  const svgBox = await page.evaluate((text) => {
    const h = [...document.querySelectorAll('h1')].find((el) => el.textContent.trim() === text);
    if (!h) return null;
    let el = h.nextElementSibling;
    while (el) {
      const svg = el.tagName === 'svg' ? el : el.querySelector('svg');
      if (svg) return svg.getBoundingClientRect();
      el = el.nextElementSibling;
    }
    return null;
  }, heading);

  if (!svgBox) return;

  const vpWidth = page.viewportSize()?.width ?? 1280;
  const vpHeight = page.viewportSize()?.height ?? 800;

  const x = Math.max(0, Math.min(box.x - 10, vpWidth - 1));
  const y = Math.max(0, Math.min(box.y - 5, vpHeight - 1));
  const width = Math.min(Math.max(box.width, svgBox.width) + 20, vpWidth - x);
  const height = Math.min(box.height + svgBox.height + 30, vpHeight - y);

  if (width <= 0 || height <= 0) return;

  await page.screenshot({
    path: path.join(SCREENSHOTS_DIR, filename),
    clip: { x, y, width, height },
  });
  console.log(`  📸 Screenshot saved: scripts/qa-screenshots/${filename}`);
}

// ── TEST 1: All-labeled line chart ─────────────────────────────────────────

console.log('TEST 1: All-labeled line chart (AI models / MMLU)');
const svg1 = await getSvgAfterHeading('Line chart with point labels');
const texts1 = await svgTextContent(svg1);

const expectedLabels = ['PaLM', 'LLaMA-65B', 'Llama 2 34B', 'Mistral 7B', 'Phi-3-mini'];
const labelTexts1 = texts1.filter((t) => expectedLabels.includes(t.text));

check('5 point labels rendered', labelTexts1.length === 5, `found ${labelTexts1.length}`);
for (const lbl of expectedLabels) {
  check(`label "${lbl}" present`, labelTexts1.some((t) => t.text === lbl));
}

// all labels should have same fill (line color)
const fills1 = [...new Set(labelTexts1.map((t) => t.fill).filter(Boolean))];
check('all labels share one fill color', fills1.length <= 1, `fills: ${JSON.stringify(fills1)}`);

// labels should appear above data points (lower y = higher on screen)
const paths1 = await svgLinePaths(svg1);
const lineStroke1 = paths1.find((p) => p.stroke && p.stroke !== 'none')?.stroke;
if (lineStroke1 && fills1[0]) {
  check(
    'label fill matches line stroke color',
    fills1[0].toLowerCase() === lineStroke1.toLowerCase(),
    `fill=${fills1[0]} stroke=${lineStroke1}`
  );
}

await screenshotSection('Line chart with point labels', '01-all-labels.png');

// ── TEST 2: Mixed labels ────────────────────────────────────────────────────

console.log('\nTEST 2: Mixed labels (some labeled, some not)');
const svg2 = await getSvgAfterHeading('Line chart with mixed labels (some points labeled, some not)');
const texts2 = await svgTextContent(svg2);

const mixedExpected = ['Launch', 'Target Hit'];
const labelTexts2 = texts2.filter((t) => mixedExpected.includes(t.text));
check('exactly 2 point labels rendered (not 4)', labelTexts2.length === 2, `found ${labelTexts2.length}`);
check('label "Launch" present', labelTexts2.some((t) => t.text === 'Launch'));
check('label "Target Hit" present', labelTexts2.some((t) => t.text === 'Target Hit'));

await screenshotSection('Line chart with mixed labels (some points labeled, some not)', '02-mixed-labels.png');

// ── TEST 3: Backward compat — existing chart without labels ────────────────

console.log('\nTEST 3: Backward compatibility (no labels on unlabeled chart)');
const svg3 = await getSvgAfterHeading('XY Charts demos');
const texts3 = await svgTextContent(svg3);
// Filter out axis/title text — look specifically for labels group
const labelsGroupTexts3 = await page.evaluate(() => {
  const svgs = document.querySelectorAll('svg');
  const first = svgs[0]; // "Sales Revenue" chart (no point labels)
  if (!first) return [];
  // look for any group with id containing "labels"
  return [...first.querySelectorAll('[id*="labels"] text, g.labels text')].map(
    (t) => t.textContent.trim()
  );
});
check('no point-label text elements in unlabeled chart', labelsGroupTexts3.length === 0, `found: ${JSON.stringify(labelsGroupTexts3)}`);

await screenshotSection('XY Charts demos', '03-backward-compat.png');

// ── TEST 4: Horizontal chart ────────────────────────────────────────────────

console.log('\nTEST 4: Horizontal orientation (existing chart, no crash)');
const svg4 = await getSvgAfterHeading('XY Charts horizontal');
const isValid4 = await page.evaluate((svg) => svg != null, svg4);
check('horizontal chart renders without error', isValid4);
await screenshotSection('XY Charts horizontal', '04-horizontal.png');

// ── TEST 5: No JS console errors from mermaid ──────────────────────────────

console.log('\nTEST 5: No console errors during rendering');
const mermaidErrors = consoleErrors.filter(
  (e) => !e.includes('favicon') && !e.includes('404')
);
check('no console errors', mermaidErrors.length === 0, mermaidErrors.join('; ').slice(0, 200));

// ── Full page screenshot ────────────────────────────────────────────────────

// scroll to the new sections and take a taller screenshot
await page.evaluate(() => {
  const headings = [...document.querySelectorAll('h1')];
  const h = headings.find((el) => el.textContent.includes('Line chart with point labels'));
  if (h) h.scrollIntoView();
});
await page.waitForTimeout(200);
await page.screenshot({
  path: path.join(SCREENSHOTS_DIR, '00-full-new-section.png'),
  fullPage: false,
});
console.log('\n  📸 Screenshot saved: scripts/qa-screenshots/00-full-new-section.png');

// ── Summary ────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log(`Screenshots: ${SCREENSHOTS_DIR}`);

await browser.close();
server.kill('SIGTERM');
process.exit(failed > 0 ? 1 : 0);
