/**
 * Regenerates the screenshots the tip cards point at.
 *
 *   npm run dev            # in another terminal
 *   node scripts/tip-shots.mjs [http://localhost:5173]
 *
 * A tip that says "Settings changes which part of the neck you read" is asking
 * the reader to go and find something, and the fastest way to describe where a
 * thing is is to show it. These are real crops of the running app rather than
 * drawings of it, which means they go stale the moment the app changes — so
 * regenerating them is one command, and it belongs in whatever change moved
 * the thing being pointed at.
 *
 * Two of each, light and dark, because the card sits in whichever scheme the
 * player chose and a light crop on a dark page reads as a hole in it.
 */
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://localhost:5173';
const OUT = new URL('../public/tips/', import.meta.url).pathname;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9444;

/**
 * What each tip points at: an expression returning the elements to crop, which
 * are boxed together into one shot. `setup` puts the app into the state where
 * that element exists and is worth looking at.
 */
const SHOTS = [
  {
    id: 'controls',
    setup: `document.querySelector('.transport [aria-label="Start"]').click()`,
    settle: 900,
    // The transport, not the row it sits in: the row is a third of the screen
    // wide and mostly empty, which would shrink the buttons to nothing.
    elements: `[document.querySelector('.transport')]`,
  },
  {
    id: 'range',
    setup: `document.querySelector('.accordion').open = true`,
    elements: `[...document.querySelectorAll('.accordion .field')].slice(0, 2)`,
  },
  { id: 'levelling', elements: `[document.querySelector('.progress-card')]` },
  // 'guide' is not here: the guide note only appears against live playing, and
  // the crop of it in public/tips was drawn by hand from the notation preview.
  // Leave it alone — this script will not overwrite what it does not generate.
  { id: 'tuning', elements: `[document.querySelector('.monitor')]` },
];

const PAD = 8;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, '--disable-gpu', '--no-first-run',
  '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
  '--user-data-dir=/tmp/sightreader-tip-shots', 'about:blank',
], { stdio: 'ignore' });

let targets;
for (let i = 0; i < 40 && !targets; i++) {
  try { targets = await fetch(`http://127.0.0.1:${PORT}/json`).then((r) => r.json()); }
  catch { await sleep(250); }
}
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));

let id = 0;
const pending = new Map();
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (pending.has(message.id)) { pending.get(message.id)(message.result); pending.delete(message.id); }
};
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const n = ++id;
    pending.set(n, resolve);
    ws.send(JSON.stringify({ id: n, method, params }));
  });
const evaluate = async (expression) =>
  (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }))
    .result?.value;

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', {
  width: 1280, height: 900, deviceScaleFactor: 2, mobile: false,
});

async function open(theme) {
  await send('Page.navigate', { url: BASE });
  await sleep(1000);
  // Past the checklist, and into the scheme being captured.
  await evaluate(`localStorage.setItem('sightreader.onboarded','true');
    localStorage.setItem('sightreader.micPermission','"granted"');
    localStorage.setItem('sightreader.instrument','"guitar"');
    localStorage.setItem('sightreader.theme', ${JSON.stringify(JSON.stringify(theme))});`);
  await send('Page.navigate', { url: BASE });
  await sleep(1600);
}

mkdirSync(OUT, { recursive: true });
/**
 * CSS size of each crop, so the card can draw it life-size rather than blown
 * up. Merged into what is already there rather than written fresh: not every
 * tip's picture is taken by this script, and dropping the ones that are not
 * left the card reading a size that did not exist.
 */
const MANIFEST = new URL('../src/ui/tip-shots.json', import.meta.url).pathname;
const sizes = JSON.parse(readFileSync(MANIFEST, 'utf8'));
for (const theme of ['light', 'dark']) {
  for (const shot of SHOTS) {
    await open(theme);
    if (shot.setup) await evaluate(shot.setup);
    await sleep(shot.settle ?? 250);

    const box = await evaluate(`(() => {
      const boxes = [...${shot.elements}].map((el) => el.getBoundingClientRect());
      const x = Math.min(...boxes.map((b) => b.x));
      const y = Math.min(...boxes.map((b) => b.y));
      return {
        x,
        y,
        width: Math.max(...boxes.map((b) => b.right)) - x,
        height: Math.max(...boxes.map((b) => b.bottom)) - y,
      };
    })()`);
    const { data } = await send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
      clip: {
        x: Math.max(0, box.x - PAD),
        y: Math.max(0, box.y - PAD),
        width: box.width + PAD * 2,
        height: box.height + PAD * 2,
        scale: 2,
      },
    });
    writeFileSync(`${OUT}${shot.id}-${theme}.png`, Buffer.from(data, 'base64'));
    sizes[shot.id] = {
      width: Math.round(box.width + PAD * 2),
      height: Math.round(box.height + PAD * 2),
    };
    console.log(`public/tips/${shot.id}-${theme}.png  ${Math.round(box.width)}x${Math.round(box.height)}`);
  }
}

writeFileSync(MANIFEST, `${JSON.stringify(sizes, null, 2)}\n`);

ws.close();
chrome.kill();
