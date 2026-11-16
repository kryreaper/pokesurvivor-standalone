import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium, firefox } = require(process.env.POKESURVIVOR_PLAYWRIGHT || 'playwright');
const [html, name = 'chrome', exe, scenario = 'smoke'] = process.argv.slice(2);
if (!html) throw new Error('Usage: node qa.mjs <HTML> <chrome|edge|firefox> [browser executable or -] [scenario]');
const destination = resolve(process.env.POKESURVIVOR_TEST_OUTPUT || './qa-output');
mkdirSync(destination, { recursive: true });
const browser = await (name === 'firefox' ? firefox : chromium).launch({
  ...(exe && exe !== '-' && { executablePath: exe }),
  headless: !process.env.POKESURVIVOR_HEADED,
  ...(name !== 'firefox' && { args: ['--enable-unsafe-swiftshader', '--disable-background-networking'] }),
  ...(name === 'firefox' && { firefoxUserPrefs: { 'webgl.force-enabled': true, 'media.autoplay.default': 1 } }),
});

const evidence = { name, browserVersion: browser.version(), network: [], errors: [], messages: [], checks: {} };
const context = await browser.newContext({ offline: true, serviceWorkers: 'block', viewport: { width: 1280, height: 760 }, acceptDownloads: true });
await context.route(/^https?:\/\//, async (route) => {
  evidence.network.push(route.request().url());
  await route.abort('internetdisconnected');
});
const page = await context.newPage();
page.on('pageerror', (error) => evidence.errors.push(error.message));
page.on('crash', () => evidence.errors.push('Renderer crashed'));
page.on('console', (msg) => {
  if (msg.type() === 'error') evidence.errors.push(msg.text());
  else if (msg.type() !== 'debug') evidence.messages.push(`${msg.type()}: ${msg.text()}`);
});
await context.addInitScript(({ scenario }) => {
  if (scenario === 'no-storage') {
    Object.defineProperty(window, 'localStorage', { get: () => { throw new Error('QA storage disabled'); } });
  }
  window.qaAudio = [];
  window.qaShortSamples = 0;
  const start = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function (...args) {
    if (this.buffer && this.buffer.duration > 0 && this.buffer.duration < 3) window.qaShortSamples++;
    return start.apply(this, args);
  };
  const connect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (destination, ...args) {
    if (destination instanceof AudioDestinationNode) {
      const monitor = this.context.createAnalyser();
      monitor.fftSize = 1024;
      connect.call(this, monitor);
      window.qaAudio.push(monitor);
    }
    return connect.call(this, destination, ...args);
  };
}, { scenario });

const settle = (ms = 300) => page.waitForTimeout(ms);
const shot = (label) => page.screenshot({ path: join(destination, `${name}-${scenario}-${label}.png`), timeout: 20000 });

try {
  await page.goto(pathToFileURL(resolve(html)).href, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.locator('#loading').waitFor({ state: 'hidden', timeout: 75000 }).catch(async () => {
    throw new Error(await page.locator('#loading-message').innerText());
  });
  evidence.checks.start = await page.evaluate(() => ({ url: location.protocol, online: navigator.onLine, pixels: [canvas.width, canvas.height] }));
  if (evidence.checks.start.url !== 'file:' || evidence.checks.start.online) throw new Error('Expected offline execution from file://');
  await settle(1200);
  await shot('title');
  await page.locator('#canvas').click({ position: { x: 25, y: 100 } });
  await settle(1200);
  evidence.checks.audio = await page.evaluate(() => window.qaAudio.map((node) => {
    const samples = new Float32Array(node.fftSize);
    node.getFloatTimeDomainData(samples);
    return { state: node.context.state, peak: Math.max(...samples.map(Math.abs)) };
  }));
  if (!evidence.checks.audio.some((node) => node.state === 'running' && node.peak > 0.001)) throw new Error('No Web Audio signal after a click');
  if (scenario === 'credits') {
    await page.locator('#canvas').click({ position: { x: 635, y: 478 } });
    for (let step = 0; step < 9; step++) {
      await page.keyboard.press('Enter', { delay: 60 });
      await settle(125);
    }
    await page.waitForFunction(() => Object.keys(JSON.parse(PokeSurvivorOffline.readSave()).owned).length > 0);
    await settle(500);
    await shot('main-menu');
    await page.getByRole('button', { name: 'Credits', exact: true }).click();
    await page.getByRole('heading', { name: 'Credits and licenses' }).waitFor();
    const credit = page.getByText('Standalone edition · KryReaper', { exact: false });
    const invite = credit.getByRole('link', { name: 'Discord invite' });
    evidence.checks.credit = await credit.innerText();
    evidence.checks.invite = await invite.getAttribute('href');
    if (evidence.checks.invite !== 'https://discord.gg/SjqVvVEh7f') throw new Error('Unexpected Discord invite');
    await shot('dialog');
    await page.locator('#credits-dialog .close').click();
    await page.setViewportSize({ width: 960, height: 620 });
    await page.waitForFunction(() => canvas.width === 960 && canvas.height < 620);
    await settle(400);
    await shot('compact-menu');
  } else if (['flow', 'stress', 'boss'].includes(scenario)) {
    await import('./qa-play.mjs').then(({ play }) => play({ page, settle, shot, evidence, browser, name, scenario }));
    evidence.checks.shortSoundSamples = await page.evaluate(() => window.qaShortSamples);
    if (evidence.checks.shortSoundSamples < 1) throw new Error('No sound effects were started during play');
  } else {
    await page.getByRole('button', { name: 'Save files' }).click();
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export Save' }).click();
    const download = await downloadPromise;
    const json = JSON.parse(readFileSync(await download.path(), 'utf8'));
    evidence.checks.export = { filename: download.suggestedFilename(), version: json.v, coins: json.coins };
    await page.locator('#save-file').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('null') });
    await page.getByText('Choose a valid PokéSurvivor standalone JSON save.', { exact: true }).waitFor();
    evidence.checks.invalidSaveRejected = true;
    json.coins += 37;
    page.once('dialog', (dialog) => dialog.accept());
    await page.locator('#save-file').setInputFiles({ name: 'import.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(json)) });
    await page.getByText('Save imported. Your trainer has been loaded.', { exact: true }).waitFor();
    evidence.checks.importCoins = await page.evaluate(() => JSON.parse(PokeSurvivorOffline.readSave()).coins);
    evidence.checks.storage = await page.locator('#storage').innerText();
    if (scenario === 'no-storage' && !evidence.checks.storage.includes('Autosave unavailable')) throw new Error('Blocked storage status was not reported');
    if (scenario !== 'no-storage') {
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 });
      await page.locator('#loading').waitFor({ state: 'hidden', timeout: 75000 });
      evidence.checks.reloadCoins = await page.evaluate(() => JSON.parse(PokeSurvivorOffline.readSave()).coins);
      if (evidence.checks.reloadCoins !== json.coins) throw new Error('Reload did not restore imported coins');
    }
    if (evidence.checks.importCoins !== json.coins) throw new Error('Imported coins did not reach the game');
    if (await page.locator('#save-dialog').isVisible()) await page.locator('#save-dialog .close').click();
    await page.getByRole('button', { name: 'Credits', exact: true }).click();
    await page.getByRole('heading', { name: 'Credits and licenses' }).waitFor();
    await page.locator('#credits-dialog summary').first().click();
    if (!(await page.locator('#credits-dialog pre').first().innerText()).includes('MIT License')) throw new Error('Missing license notice');
    await page.locator('#credits-dialog .close').click();
    evidence.checks.credits = true;
    if (await page.locator('#fullscreen').isVisible()) {
      await page.locator('#fullscreen').click();
      await page.waitForFunction(() => document.fullscreenElement?.id === 'game', undefined, { timeout: 5000 });
      await page.locator('#fullscreen').click();
      await page.waitForFunction(() => !document.fullscreenElement, undefined, { timeout: 5000 });
      evidence.checks.fullscreen = true;
    }
    await page.setViewportSize({ width: 960, height: 620 });
    await page.waitForFunction(() => canvas.width === 960 && canvas.height < 620, undefined, { timeout: 5000 });
    evidence.checks.resized = true;
  }
  if (evidence.network.length) throw new Error(`HTTP(S) requested ${evidence.network.length} times`);
} catch (error) {
  evidence.failure = error.stack;
  process.exitCode = 1;
  await shot('failure').catch(() => {});
} finally {
  await browser.close();
  writeFileSync(join(destination, `${name}-${scenario}.json`), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ ...evidence, messages: evidence.messages.slice(0, 12), errors: evidence.errors.slice(0, 25) }, null, 2));
}
