#!/usr/bin/env node

import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pluginName = 'com.christitustech.codex-status.sdPlugin';
const pluginRoot = path.join(root, 'plugin', pluginName);
const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const manifest = JSON.parse(await readFile(path.join(pluginRoot, 'manifest.json'), 'utf8'));
const discordPluginRoot = path.join(
  root,
  'plugin',
  'com.christitustech.discord-notifications.sdPlugin'
);
const discordManifest = JSON.parse(
  await readFile(path.join(discordPluginRoot, 'manifest.json'), 'utf8')
);

if (packageJson.version !== manifest.Version) {
  throw new Error(`Version mismatch: package.json=${packageJson.version}, manifest=${manifest.Version}`);
}

if (manifest.CodePath !== 'index.js') throw new Error('Manifest CodePath must be index.js');
if (!manifest.OS?.some((entry) => entry.Platform === 'linux')) throw new Error('Manifest must support Linux');
if (manifest.Actions?.length !== 1) throw new Error('Manifest must contain one Codex Status action');
if (discordManifest.CodePath !== 'index.js') {
  throw new Error('Discord manifest CodePath must be index.js');
}
if (!discordManifest.OS?.some((entry) => entry.Platform === 'linux')) {
  throw new Error('Discord manifest must support Linux');
}
if (discordManifest.Actions?.length !== 1) {
  throw new Error('Discord manifest must contain one notification action');
}

await Promise.all([
  access(path.join(pluginRoot, manifest.CodePath)),
  access(path.join(pluginRoot, `${manifest.Icon}.svg`)),
  access(path.join(pluginRoot, `${manifest.Actions[0].Icon}.svg`)),
  access(path.join(discordPluginRoot, discordManifest.CodePath)),
  access(path.join(discordPluginRoot, `${discordManifest.Icon}.svg`)),
  access(path.join(discordPluginRoot, `${discordManifest.Actions[0].Icon}.svg`))
]);

const JavaScriptFiles = [
  'plugin/com.christitustech.codex-status.sdPlugin/index.js',
  'plugin/com.christitustech.codex-status.sdPlugin/lib/render.js',
  'plugin/com.christitustech.codex-status.sdPlugin/lib/status.js',
  'plugin/com.christitustech.discord-notifications.sdPlugin/index.js',
  'plugin/com.christitustech.discord-notifications.sdPlugin/lib/notifications.js',
  'scripts/build.mjs',
  'scripts/check.mjs',
  'scripts/install.mjs',
  'scripts/package.mjs',
  'scripts/lib/zip.mjs'
];

for (const file of JavaScriptFiles) {
  execFileSync(process.execPath, ['--check', path.join(root, file)], { stdio: 'inherit' });
}

console.log('Project checks passed');
