import { createHash } from 'node:crypto';
import { closeSync, mkdirSync, openSync, readFileSync, writeFileSync, writeSync } from 'node:fs';
import { join } from 'node:path';

const [source, destination] = process.argv.slice(2);
if (!source || !destination) {
  throw new Error('Usage: node build-hosted.mjs PokeSurvivor-Standalone.html output-directory');
}

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
  files[name] = `${name}.${resource.hash.digest('hex').slice(0, 16)}.bin`;
  const fd = openSync(join(destination, files[name]), 'w');
  try {
    for (const chunk of resource.chunks) writeSync(fd, chunk);
  } finally {
    closeSync(fd);
  }
}

const start = shell.indexOf('function embeddedStream(name) {');
const end = shell.indexOf('async function readResource(name) {', start);
if (start < 0 || end < 0) throw new Error('Missing resource loader');

const networkLoader = `const resourceFiles = ${JSON.stringify(files)};
function embeddedStream(name) {
  let reader;
  let packedBytes = 0;
  return new ReadableStream({
    async start() {
      const response = await fetch(resourceFiles[name]);
      if (!response.ok || !response.body) throw new Error(\`Could not load \${name} (HTTP \${response.status}).\`);
      reader = response.body.getReader();
    },
    async pull(controller) {
      const { value, done } = await reader.read();
      if (done) {
        if (packedBytes !== manifest[name].packed) throw new Error(\`Incomplete game resource: \${name}\`);
        controller.close();
        return;
      }
      packedBytes += value.length;
      bytesRead += value.length;
      progress.value = bytesRead;
      controller.enqueue(value);
    },
    cancel(reason) { return reader?.cancel(reason); },
  }).pipeThrough(new DecompressionStream('gzip'));
}

`;
const policy = "default-src 'none';";
if (!shell.includes(policy)) throw new Error('Missing content security policy');
const page = (shell.slice(0, start) + networkLoader + shell.slice(end))
  .replace(policy, `${policy} connect-src 'self';`)
  .replace('Reading the embedded game…', 'Loading PokéSurvivor…');
writeFileSync(join(destination, 'index.html'), page);
writeFileSync(join(destination, '.nojekyll'), '');
console.log(`Packaged ${resources.size} game resources and ${Buffer.byteLength(page).toLocaleString()} bytes of HTML.`);
