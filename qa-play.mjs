import { execFileSync } from 'node:child_process';

const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const keyboard = ['a', 'd', 'w', 's'];

async function memory(browser, page) {
  const session = await browser.newBrowserCDPSession();
  const { processInfo } = await session.send('SystemInfo.getProcessInfo');
  await session.detach();
  const renderers = processInfo.filter((entry) => entry.type === 'renderer').map((entry) => entry.id);
  const workingSet = Number(execFileSync('powershell.exe', [
    '-NoProfile', '-Command', `(Get-Process -Id ${renderers.join(',')} -ErrorAction SilentlyContinue | Measure-Object -Property WorkingSet64 -Sum).Sum`,
  ], { encoding: 'utf8', windowsHide: true }).trim()) / 1048576;
  const heap = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? null);
  return { rendererWorkingSetMiB: Math.round(workingSet), jsHeapMiB: heap === null ? null : Math.round(heap / 1048576) };
}

export async function play({ page, settle, shot, evidence, browser, name, scenario }) {
  const get = () => page.evaluate(() => PokeSurvivorOffline.diagnostics);
  const wait = (predicate, timeout = 10000) => page.waitForFunction(predicate, undefined, { timeout });
  const press = (key) => page.keyboard.press(key, { delay: 60 });
  const picture = async (label) => { await settle(550); await shot(label); };
  const saved = () => page.evaluate(() => JSON.parse(PokeSurvivorOffline.readSave()));
  const click = (x, y) => page.locator('#canvas').click({ position: { x, y } });
  await page.evaluate(() => { PokeSurvivorOffline.diagnosticsEnabled = true; });

  if (scenario === 'stress' || scenario === 'boss') {
    const profile = await saved();
    profile.selected = 4;
    profile.owned['4'] = { n: 1, shiny: false };
    profile.settings.adaptive = false;
    profile.settings.quality = 3;
    if (scenario === 'stress') {
      profile.mods = ['horde', 'plague'];
      profile.pup['4'] = { hp: 10, def: 8, regen: 5, spd: 8, revive: 2, magnet: 6, xp: 8 };
    }
    await page.getByRole('button', { name: 'Save files' }).click();
    page.once('dialog', (dialog) => dialog.accept());
    await page.locator('#save-file').setInputFiles({ name: 'profile.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(profile)) });
    await page.getByText('Save imported. Your trainer has been loaded.', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await settle(900);
    await click(90, 34);
  } else {
    await click(635, 478);
    for (let step = 0; step < 9; step++) {
      await press('Enter');
      await settle(125);
    }
    await wait(() => Object.keys(JSON.parse(PokeSurvivorOffline.readSave()).owned).length > 0);
  }
  evidence.checks.selected = (await saved()).selected;
  await picture('main-menu');
  await click(1088, 94);
  await picture('mode-menu');
  if (scenario === 'boss') await click(205, 325);
  await click(835, 630);
  await wait(() => (PokeSurvivorOffline.diagnostics?.time ?? 0) > 0.3, 18000);
  const first = await get();
  await picture('first-run');
  await press('Escape');
  await wait(() => PokeSurvivorOffline.diagnostics?.paused);
  const paused = await get();
  await settle(1700);
  if ((await get()).time !== paused.time) throw new Error('The survival timer advanced during pause');
  await picture('paused');
  await press('Escape');
  await wait(() => PokeSurvivorOffline.diagnostics?.paused === false);
  evidence.checks.pause = true;

  const start = await get();
  await page.keyboard.down('d');
  await settle(1100);
  await page.keyboard.up('d');
  await settle(250);
  const end = await get();
  await page.keyboard.down('ArrowDown');
  await settle(1100);
  await page.keyboard.up('ArrowDown');
  await settle(250);
  const arrows = await get();
  evidence.checks.movement = { wasd: distance(start.position, end.position), arrows: distance(end.position, arrows.position) };
  if (evidence.checks.movement.wasd < 5 || evidence.checks.movement.arrows < 5) throw new Error('Movement did not respond');

  const samples = [];
  const keys = new Set();
  const startAt = Date.now();
  const maxMs = scenario === 'boss' ? 90000 : 240000;
  let nextSample = 0;
  let firstChoice;
  let upgradeConfirmed = false;
  let bossSeen = false;
  let xpSeen = false;
  let dead = false;
  let peakEnemies = first.enemies;
  let peakBullets = 0;
  let heldFor = 0;

  async function steer(active) {
    for (const key of keys) {
      if (!active.has(key)) { await page.keyboard.up(key); keys.delete(key); }
    }
    for (const key of active) {
      if (!keys.has(key)) { await page.keyboard.down(key); keys.add(key); }
    }
  }

  while (Date.now() - startAt < maxMs) {
    const run = await get();
    if (!run) break;
    if (run.dead) { dead = true; break; }
    peakEnemies = Math.max(peakEnemies, run.enemies);
    peakBullets = Math.max(peakBullets, run.bullets);
    xpSeen ||= run.xp > 0 || run.level > 1;
    if (run.boss && !bossSeen) {
      bossSeen = true;
      await picture('boss');
      if (scenario === 'boss') break;
    }
    if (run.choices) {
      await steer(new Set());
      if (!firstChoice && run.level > 1) {
        firstChoice = run;
        await picture('upgrade-cards');
      }
      await settle(820);
      if (run.choices === 3) await click(319, 395);
      else await press('Enter');
      await settle(420);
      const after = await get();
      if (firstChoice && after && !after.choices) {
        upgradeConfirmed ||= JSON.stringify(firstChoice.moves) !== JSON.stringify(after.moves) || JSON.stringify(firstChoice.upgrades) !== JSON.stringify(after.upgrades);
      }
      continue;
    }
    if (Date.now() >= nextSample) {
      const sample = { time: Number(run.time.toFixed(1)), fps: run.fps, enemies: run.enemies, kills: run.kills, hp: Math.round(run.hp) };
      if (name !== 'firefox') Object.assign(sample, await memory(browser, page));
      samples.push(sample);
      if (scenario === 'stress') console.log(JSON.stringify(sample));
      nextSample = Date.now() + 12000;
    }
    const aim = new Set();
    const target = scenario === 'flow' && upgradeConfirmed ? run.nearestEnemy : run.nearestOrb;
    if (target) {
      for (let axis = 0; axis < 2; axis++) {
        const delta = target[axis] - run.position[axis];
        if (Math.abs(delta) > 16) aim.add(keyboard[axis * 2 + (delta > 0 ? 1 : 0)]);
      }
      heldFor++;
      if (heldFor % 16 >= 12) aim.add(keyboard[Math.floor(heldFor / 16) % 4]);
    }
    await steer(aim);
    await settle(320);
  }
  await steer(new Set());
  evidence.checks.run = { peakEnemies, peakBullets, bossSeen, xpSeen, firstChoice, upgradeConfirmed, dead, samples, last: await get() };
  if (scenario === 'flow') {
    if (!xpSeen || firstChoice?.choices !== 3 || !upgradeConfirmed || !dead) throw new Error('Flow did not reach XP, three choices, an effective upgrade and death');
    await settle(6200);
    await picture('game-over');
    for (let attempt = 0; attempt < 3 && await get(); attempt++) {
      await press('Enter');
      await settle(800);
    }
    await wait(() => !PokeSurvivorOffline.diagnostics);
    await picture('summary');
    evidence.checks.completedRun = (await saved()).stats;
    await press('Shift+Tab');
    await press('Enter');
    await wait(() => (PokeSurvivorOffline.diagnostics?.time ?? 0) > 0.3);
    evidence.checks.restart = true;
  }
  if (scenario === 'boss' && !bossSeen) throw new Error('Boss did not spawn during Boss Rush');
  if (scenario === 'stress' && (samples.length < 4 || peakEnemies < 10)) throw new Error('The run did not reach the stress sampling thresholds');
}
