#!/usr/bin/env node

import { mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createZip } from './lib/zip.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pluginName = 'com.christitustech.codex-status.sdPlugin';
const manifest = JSON.parse(await readFile(path.join(root, 'dist', pluginName, 'manifest.json'), 'utf8'));
const releaseDirectory = path.join(root, 'release');
const destination = path.join(releaseDirectory, `codex-status-v${manifest.Version}.streamDeckPlugin`);

await rm(releaseDirectory, { recursive: true, force: true });
await mkdir(releaseDirectory, { recursive: true });

const entries = await createZip(path.join(root, 'dist', pluginName), destination, pluginName);
console.log(`Packaged release/${path.basename(destination)} (${entries.length} files)`);
