#!/usr/bin/env node

import { build } from 'esbuild';
import { chmod, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pluginNames = [
  'com.christitustech.codex-status.sdPlugin',
  'com.christitustech.discord-notifications.sdPlugin'
];

await rm(path.join(root, 'dist'), { recursive: true, force: true });
const license = await readFile(path.join(root, 'LICENSE'), 'utf8');

for (const pluginName of pluginNames) {
  const source = path.join(root, 'plugin', pluginName);
  const destination = path.join(root, 'dist', pluginName);

  await mkdir(destination, { recursive: true });
  await build({
    bundle: true,
    entryPoints: [path.join(source, 'index.js')],
    outfile: path.join(destination, 'index.js'),
    platform: 'node',
    target: 'node18',
    format: 'cjs',
    minify: false,
    legalComments: 'none'
  });

  await chmod(path.join(destination, 'index.js'), 0o755);
  await cp(path.join(source, 'icons'), path.join(destination, 'icons'), { recursive: true });
  await cp(path.join(source, 'manifest.json'), path.join(destination, 'manifest.json'));
  await writeFile(path.join(destination, 'LICENSE'), license);

  console.log(`Built dist/${pluginName}`);
}
