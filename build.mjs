import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, statSync, writeSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync, gunzipSync } from 'node:zlib';
import { prepare, upstreamRevision } from './prepare.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const [projectArg, godotArg, templateArg, outputArg] = process.argv.slice(2, 6);
const packOnly = process.argv.includes('--pack-only');
if (!projectArg || !godotArg || !templateArg || !outputArg) {
  console.error('Usage: node build.mjs <disposable upstream checkout> <Godot console executable> <web_nothreads_release.zip> <output HTML> [--pack-only]');
  process.exit(1);
}

const project = resolve(projectArg);
const godot = resolve(godotArg);
const template = resolve(templateArg);
const output = resolve(outputArg);
const web = join(dirname(project), 'web-export');
const assets = ['godot.wasm', 'game.pck', 'godot.audio.worklet.js', 'godot.audio.position.worklet.js'];
const required = [
  'project.godot', 'scenes/menu.tscn', 'scenes/main.tscn', 'scripts/main.gd', 'scripts/menu.gd',
  'data/pokedex.json', 'data/sprite_meta.json', 'data/lang_en.json', 'fonts/PixelifySansFix.ttf',
  'assets/ui/logo.png', 'assets/world/ground_grass.png', 'audio/sfx_levelup.ogg', 'LICENSE', 'CREDITS.md',
];

function run(args, log) {
  const fd = openSync(log, 'w');
  try {
    console.log(`Godot ${args.at(-1)} → ${log}`);
    const result = spawnSync(godot, args, { stdio: ['ignore', fd, fd], windowsHide: true });
    if (result.error) throw result.error;
    const text = readFileSync(log, 'utf8');
    if (result.status !== 0 || /(?:SCRIPT ERROR|Parse Error|ERROR:)/.test(text)) {
      throw new Error(`Godot failed (${result.status}). See ${log}`);
    }
  } finally {
    closeSync(fd);
  }
}

function exact(source, oldText, newText) {
  if (!source.includes(oldText) || source.indexOf(oldText) !== source.lastIndexOf(oldText)) {
    throw new Error(`Incompatible Godot Web template. Missing or repeated loader code: ${oldText}`);
  }
  return source.replace(oldText, () => newText);
}

function loader() {
  let code = readFileSync(join(web, 'godot.js'), 'utf8');
  code = exact(code, "\tSafeEngine['load'] = Engine.load;", `
  SafeEngine.loadEmbedded = function (response) {
    loadPath = 'godot';
    loadPromise = Promise.resolve(response);
    return loadPromise;
  };
  SafeEngine['load'] = Engine.load;`);
  for (const name of ['audio.worklet.js', 'audio.position.worklet.js']) {
    code = exact(code, 'return `${loadPath}.' + name + '`;', `return window.PokeSurvivorOffline.audioModule('godot.${name}');`);
  }
  code = exact(code, 'FS.writeFile(path,new Uint8Array(buffer))',
    'FS.writeFile(path,buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer),{canOwn:true})');
  code = exact(code, 'navigator.serviceWorker.getRegistration().then(GodotPWA.updateState.bind(null,cb))', 'return');
  code = exact(code, 'WebAssembly.instantiateStreaming(Promise.resolve(r), imports).then(done);',
    'WebAssembly.instantiateStreaming(Promise.resolve(r), imports).then(done, (error) => { throw error; });');
  return code;
}

const escape = (str) => str.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
function notices() {
  const files = [
    ['PokéSurvivor code and game notices', join(project, 'LICENSE')],
    ['Sprite artists and original game credits', join(project, 'CREDITS.md')],
    ['Creative Commons Attribution-NonCommercial 4.0', join(here, 'notices/CC-BY-NC-4.0.txt')],
    ['Pixelify Sans', join(project, 'fonts/OFL.txt')],
    ['Noto Sans CJK', join(here, 'notices/Noto-Sans-CJK-OFL.txt')],
    ['Inter', join(here, 'notices/Inter-OFL.txt')],
    ['Godot Engine MIT license', join(here, 'notices/Godot-LICENSE.txt')],
    ['Godot third-party notices', join(here, 'notices/Godot-COPYRIGHT.txt')],
  ];
  return files.map(([label, path]) => `<details><summary>${label}</summary><pre>${escape(readFileSync(path, 'utf8'))}</pre></details>`).join('\n');
}

console.log(`Expected upstream source revision ${upstreamRevision}`);
const missing = required.filter((name) => !existsSync(join(project, name)));
if (missing.length) throw new Error(`Missing required Godot resources: ${missing.join(', ')}`);
mkdirSync(dirname(output), { recursive: true });
mkdirSync(web, { recursive: true });
if (!packOnly) {
  prepare(project, template);
  const args = ['--headless', '--path', project];
  run([...args, '--editor', '--import'], join(web, 'import.log'));
  run([...args, '--export-release', 'Standalone Web', join(web, 'godot.html')], join(web, 'export.log'));
  renameSync(join(web, 'godot.pck'), join(web, 'game.pck'));
}

const manifest = {};
const compressed = new Map();
for (const name of assets) {
  const file = readFileSync(join(web, name));
  if (!file.length) throw new Error(`Empty export asset: ${name}`);
  if (name === 'game.pck' && file.toString('ascii', 0, 4) !== 'GDPC') throw new Error('Invalid Godot resource pack');
  if (name === 'godot.wasm' && !WebAssembly.validate(file)) throw new Error('Invalid exported WebAssembly');
  const packed = gzipSync(file, { level: 6 });
  if (!gunzipSync(packed).equals(file)) throw new Error(`Round-trip compression failed for ${name}`);
  manifest[name] = { size: file.length, packed: packed.length };
  compressed.set(name, packed);
  console.log(`${name}: ${file.length.toLocaleString()} bytes → ${packed.length.toLocaleString()} embedded bytes before base64`);
}

const replacements = {
  CSS: readFileSync(join(here, 'shell.css'), 'utf8'),
  NOTICES: notices(),
  ENGINE: loader(),
  BOOT: readFileSync(join(here, 'boot.js'), 'utf8')
    .replace('@@MANIFEST@@', JSON.stringify(manifest))
    .replace('@@GAME_VERSION@@', JSON.stringify(gameVersion())),
};

function gameVersion() {
  const match = readFileSync(join(project, 'project.godot'), 'utf8').match(/^config\/version="([0-9.]+)"/m);
  if (!match) throw new Error('Missing game version in project.godot');
  return match[1];
}
for (const key of ['BOOT', 'ENGINE']) {
  if (/<\/script\b/i.test(replacements[key])) throw new Error(`Unexpected HTML script terminator in ${key}`);
  spawnCheck(key, replacements[key]);
}

function spawnCheck(name, code) {
  const result = spawnSync(process.execPath, ['--check'], { input: code, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`${name} script failed validation: ${result.stderr}`);
}

const html = readFileSync(join(here, 'shell.html'), 'utf8').replace(/@@(CSS|NOTICES|ENGINE|BOOT)@@/g, (_, key) => replacements[key]);
const [header, footer] = html.split('@@PAYLOAD@@');
if (!header || !footer || /@@[A-Z]+@@/.test(header + footer) || /<(?:script|link)\b[^>]*(?:src|href)\s*=/i.test(header + footer)) {
  throw new Error('HTML has an unresolved build token or external runtime element');
}

const temp = `${output}.tmp`;
const fd = openSync(temp, 'w');
const hash = createHash('sha256');
const chunkSize = 256 * 1024;
function write(value) {
  writeSync(fd, value);
  hash.update(value);
}
try {
  write(header);
  for (const [name, bytes] of compressed) {
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      const chunk = bytes.subarray(offset, offset + chunkSize);
      const encoded = chunk.toString('base64');
      if (!Buffer.from(encoded, 'base64').equals(chunk)) throw new Error(`Base64 round-trip failed for ${name}`);
      write(`<script type="application/octet-stream" data-embedded="${name}">${encoded}</script>\n`);
    }
  }
  write(footer);
} finally {
  closeSync(fd);
}
renameSync(temp, output);
console.log(`${output}\nSize: ${statSync(output).size.toLocaleString()} bytes\nSHA-256: ${hash.digest('hex')}\nMissing required resources: 0`);
