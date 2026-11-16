'use strict';

const byId = (id) => document.getElementById(id);
const canvas = byId('canvas');
const progress = byId('progress');
const loadingMessage = byId('loading-message');
const saveMessage = byId('save-message');
const saveDialog = byId('save-dialog');
const saveFile = byId('save-file');
const saveButton = byId('save');
const creditsDialog = byId('credits-dialog');
const saveKey = 'pokesurvivor.offline.godot6.2.save';
const saveLimit = 8 * 1024 * 1024;
const manifest = @@MANIFEST@@;
const firstProfile = JSON.stringify({ notes_seen: @@GAME_VERSION@@ });
const audioModules = Object.create(null);
let save = '';
let importer;
let pauseRun;
let waitForImport = false;
let gameReady = false;

function storageStatus(available) {
  byId('storage').textContent = available ? 'Local autosave on' : 'Autosave unavailable · Export Save to keep progress';
}

function validSave(raw) {
  const data = JSON.parse(raw);
  const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
  const objects = ['owned', 'stats', 'settings', 'pup', 'upgrades', 'claimed', 'pity', 'legends', 'arenas', 'pban', 'pbind', 'ptm', 'pz', 'lshiny'];
  if (!record(data) || data.v !== 1 || !objects.slice(0, 3).every((key) => record(data[key])) ||
      objects.some((key) => key in data && !record(data[key])) ||
      !Number.isInteger(data.selected) || data.selected < 1 || data.selected > 20000 ||
      !Number.isSafeInteger(data.coins) || data.coins < 0) {
    throw new Error('Choose a valid PokéSurvivor standalone JSON save.');
  }
  return raw;
}

try {
  const raw = localStorage.getItem(saveKey);
  if (raw) save = validSave(raw);
  storageStatus(true);
} catch (error) {
  storageStatus(false);
}

function showCredits() {
  pauseRun?.();
  if (!creditsDialog.open) creditsDialog.showModal();
}

window.PokeSurvivorOffline = {
  ready() {
    gameReady = true;
    byId('loading').hidden = true;
    saveButton.disabled = !importer;
    canvas.focus();
  },
  setRunActive(active) {
    if (!active) this.diagnostics = null;
    saveButton.disabled = active || !gameReady || !importer;
    saveButton.title = active ? 'Save files are available from the title menu' : '';
  },
  registerImporter(callback) { importer = callback; },
  registerPause(callback) { pauseRun = callback; },
  readSave() { return save || firstProfile; },
  writeSave(raw) {
    save = raw;
    try {
      localStorage.setItem(saveKey, raw);
      storageStatus(true);
    } catch (error) {
      storageStatus(false);
    }
  },
  importResult(ok) {
    waitForImport = false;
    byId('import').disabled = false;
    saveMessage.textContent = ok ? 'Save imported. Your trainer has been loaded.' : 'The game could not load that save.';
  },
  showCredits,
  diagnosticsEnabled: false,
  diagnostics: null,
  publishDiagnostics(raw) { this.diagnostics = JSON.parse(raw); },
  audioModule(path) {
    const url = audioModules[path];
    if (!url) throw new Error(`Missing embedded audio module: ${path}`);
    return url;
  },
};

document.addEventListener('visibilitychange', () => {
  if (document.hidden) pauseRun?.();
});

saveButton.addEventListener('click', () => {
  saveMessage.textContent = '';
  saveDialog.showModal();
});
byId('credits').addEventListener('click', showCredits);
for (const dialog of [saveDialog, creditsDialog]) {
  dialog.querySelector('.close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { if (gameReady) canvas.focus(); });
}

byId('export').addEventListener('click', () => {
  if (!save) {
    saveMessage.textContent = 'Play or change a setting to create a save first.';
    return;
  }
  const url = URL.createObjectURL(new Blob([save], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'PokeSurvivor-Save.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 15000);
  saveMessage.textContent = 'Save exported.';
});

byId('import').addEventListener('click', () => saveFile.click());
saveFile.addEventListener('change', async () => {
  const file = saveFile.files[0];
  saveFile.value = '';
  if (!file || !importer || waitForImport) return;
  try {
    if (file.size > saveLimit) throw new Error('This file exceeds the 8 MiB save limit.');
    const raw = validSave(await file.text());
    if (!window.confirm('Replace your current trainer progress and settings with this save?')) return;
    waitForImport = true;
    byId('import').disabled = true;
    importer(raw);
  } catch (error) {
    waitForImport = false;
    byId('import').disabled = false;
    saveMessage.textContent = error instanceof SyntaxError ? 'The file is not valid JSON.' : error.message;
  }
});

const full = byId('fullscreen');
if (document.fullscreenEnabled && byId('game').requestFullscreen) {
  full.hidden = false;
  full.addEventListener('click', async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await byId('game').requestFullscreen();
      if (gameReady) canvas.focus();
    } catch (error) {
      full.title = error.message;
    }
  });
  document.addEventListener('fullscreenchange', () => {
    full.textContent = document.fullscreenElement ? 'Exit fullscreen' : 'Fullscreen';
  });
}

canvas.addEventListener('webglcontextlost', () => fail('Graphics context lost. Reload the file to return to the title screen.'));
const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));
let bytesRead = 0;
progress.max = Object.values(manifest).reduce((sum, asset) => sum + asset.packed, 0);
progress.value = 0;

function embeddedStream(name) {
  const elements = document.querySelectorAll(`[data-embedded="${name}"]`);
  if (!elements.length) throw new Error(`Missing embedded resource: ${name}`);
  let index = 0;
  let packedBytes = 0;
  return new ReadableStream({
    async pull(controller) {
      if (index === elements.length) {
        if (packedBytes !== manifest[name].packed) throw new Error(`Incomplete embedded resource: ${name}`);
        controller.close();
        return;
      }
      const el = elements[index++];
      const bytes = decodeBase64(el.textContent);
      el.remove();
      controller.enqueue(bytes);
      packedBytes += bytes.length;
      bytesRead += bytes.length;
      progress.value = bytesRead;
      if (index % 12 === 0) await nextFrame();
    },
  }).pipeThrough(new DecompressionStream('gzip'));
}

function decodeBase64(encoded) {
  if (Uint8Array.fromBase64) return Uint8Array.fromBase64(encoded);
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function readResource(name) {
  const result = new Uint8Array(manifest[name].size);
  const reader = embeddedStream(name).getReader();
  let offset = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    result.set(value, offset);
    offset += value.length;
  }
  if (offset !== result.length) throw new Error(`Incorrect size for ${name}`);
  return result;
}

function fail(error) {
  byId('loading').hidden = false;
  progress.hidden = true;
  loadingMessage.textContent = error?.message || String(error);
}

async function boot() {
  if (!Engine.isWebGLAvailable(2)) throw new Error('This game requires WebGL 2. Enable hardware acceleration or try a browser with WebGL 2 support.');
  if (!window.DecompressionStream || !window.WebAssembly) throw new Error('Open this file in a current desktop browser with WebAssembly and gzip decompression support.');
  const worklets = ['godot.audio.worklet.js', 'godot.audio.position.worklet.js'];
  for (const name of worklets) {
    const source = await readResource(name);
    audioModules[name] = `data:text/javascript;base64,${btoa(String.fromCharCode(...source))}`;
  }

  loadingMessage.textContent = 'Unpacking game assets and compiling the engine…';
  const stage = byId('stage');
  function fitCanvas() {
    const scale = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(stage.clientWidth * scale));
    const height = Math.max(1, Math.round(stage.clientHeight * scale));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
  }
  new ResizeObserver(fitCanvas).observe(stage);
  fitCanvas();
  const engine = new Engine({
    canvas,
    canvasResizePolicy: 0,
    focusCanvas: true,
    executable: 'godot',
    persistentPaths: [],
    args: ['--main-pack', 'game.pck'],
    onExit: (code) => fail(code ? `The engine stopped with error ${code}. Reload to try again.` : 'Game closed. Reload to return to the title screen.'),
  });
  await Promise.all([
    Engine.loadEmbedded(new Response(embeddedStream('godot.wasm'), { headers: { 'Content-Type': 'application/wasm' } })).then(() => engine.init()),
    readResource('game.pck').then((pack) => engine.preloadFile(pack, 'game.pck')),
  ]);
  loadingMessage.textContent = 'Opening the title screen…';
  progress.removeAttribute('value');
  await engine.start();
  setTimeout(() => { if (!gameReady) fail('The title screen did not open. Reload the file to try again.'); }, 30000);
}

window.addEventListener('unhandledrejection', (event) => { if (!gameReady) fail(event.reason); });
requestAnimationFrame(() => boot().catch(fail));
