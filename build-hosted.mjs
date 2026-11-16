import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [source, destination, mode] = process.argv.slice(2);
if (!source || !destination) {
  throw new Error('Usage: node build-hosted.mjs PokeSurvivor-Standalone.html output-directory [--cdn]');
}
if (mode && mode !== '--cdn') throw new Error(`Unknown option: ${mode}`);
const maxPartBytes = mode === '--cdn' ? 16_000_000 : Infinity;

const html = readFileSync(source, 'utf8');
const firstPayload = html.indexOf('<script type="application/octet-stream" data-embedded=');
const lastPayload = html.lastIndexOf('<script type="application/octet-stream" data-embedded=');
const endPayload = html.indexOf('</script>', lastPayload) + '</script>'.length;
if (firstPayload < 0 || lastPayload < 0 || endPayload <= lastPayload) throw new Error('Missing embedded resource data');

const shell = html.slice(0, firstPayload) + html.slice(endPayload);
const manifestLine = shell.match(/^const manifest = (.+);$/m);
if (!manifestLine) throw new Error('Missing resource manifest');
const manifest = JSON.parse(manifestLine[1]);
mkdirSync(destination, { recursive: true });
const resources = new Map(Object.keys(manifest).map((name) => [name, { chunks: [], size: 0, hash: createHash('sha256') }]));
const pattern = /<script type="application\/octet-stream" data-embedded="([a-z.]+)">([A-Za-z0-9+/=]+)<\/script>/g;
pattern.lastIndex = firstPayload;
for (const [, name, encoded] of html.matchAll(pattern)) {
  const resource = resources.get(name);
  if (!resource) throw new Error(`Unexpected resource ${name}`);
  const bytes = Buffer.from(encoded, 'base64');
  resource.chunks.push(bytes);
  resource.hash.update(bytes);
  resource.size += bytes.length;
}

const files = {};
for (const [name, resource] of resources) {
  if (resource.size !== manifest[name].packed) throw new Error(`Incomplete resource ${name}`);
  const prefix = `${name}.${resource.hash.digest('hex').slice(0, 16)}`;
  files[name] = [];
  const bytes = Buffer.concat(resource.chunks, resource.size);
  for (let offset = 0; offset < bytes.length; offset += maxPartBytes) {
    const filename = bytes.length <= maxPartBytes ? `${prefix}.bin` : `${prefix}.part${files[name].length + 1}.bin`;
    files[name].push(filename);
    writeFileSync(join(destination, filename), bytes.subarray(offset, offset + maxPartBytes));
  }
}

const start = shell.indexOf('function embeddedStream(name) {');
const end = shell.indexOf('async function readResource(name) {', start);
if (start < 0 || end < 0) throw new Error('Missing resource loader');

const networkLoader = `const resourceFiles = ${JSON.stringify(files)};
const assetBase = ${mode === '--cdn' ? `document.querySelector('meta[name="game-assets"]')?.content || location.href` : 'location.href'};
function embeddedStream(name) {
  let index = 0;
  let reader;
  let packedBytes = 0;
  return new ReadableStream({
    async pull(controller) {
      while (true) {
        if (!reader) {
          const filename = resourceFiles[name][index++];
          if (!filename) {
            if (packedBytes !== manifest[name].packed) throw new Error(\`Incomplete game resource: \${name}\`);
            controller.close();
            return;
          }
          const response = await fetch(new URL(filename, assetBase));
          if (!response.ok || !response.body) throw new Error(\`Could not load \${filename} (HTTP \${response.status}).\`);
          reader = response.body.getReader();
        }
        const { value, done } = await reader.read();
        if (done) {
          reader.releaseLock();
          reader = undefined;
          continue;
        }
        packedBytes += value.length;
        bytesRead += value.length;
        progress.value = bytesRead;
        controller.enqueue(value);
        return;
      }
    },
    cancel(reason) { return reader?.cancel(reason); },
  }).pipeThrough(new DecompressionStream('gzip'));
}

`;
const policy = "default-src 'none';";
if (!shell.includes(policy)) throw new Error('Missing content security policy');
const page = (shell.slice(0, start) + networkLoader + shell.slice(end))
  .replace(policy, `${policy} connect-src 'self'${mode === '--cdn' ? ' https://cdn.jsdelivr.net' : ''};`)
  .replace('Reading the embedded game…', 'Loading PokéSurvivor…');
writeFileSync(join(destination, 'index.html'), page);
writeFileSync(join(destination, '.nojekyll'), '');
console.log(`Packaged ${resources.size} game resources and ${Buffer.byteLength(page).toLocaleString()} bytes of HTML.`);
