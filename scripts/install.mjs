#!/usr/bin/env node

import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { chmodSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PLUGIN_DIRECTORY = 'com.christitustech.codex-status.sdPlugin';
const PLUGIN_UUID = 'com.christitustech.codex-status.monitor';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const options = { slot: null };

  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--slot') options.slot = Number.parseInt(argv[index + 1], 10);
    if (argv[index] === '--profile') options.profile = argv[index + 1];
  }

  if (options.slot !== null && (!Number.isInteger(options.slot) || options.slot < 0)) {
    throw new Error('--slot must be a non-negative integer');
  }

  return options;
}

async function findProfile(configRoot, requestedProfile) {
  if (requestedProfile) return path.resolve(requestedProfile);

  const profilesRoot = path.join(configRoot, 'profiles');
  const devices = await readdir(profilesRoot, { withFileTypes: true });

  for (const device of devices) {
    if (!device.isDirectory()) continue;
    const candidate = path.join(profilesRoot, device.name, 'Default.json');
    try {
      await readFile(candidate);
      return candidate;
    } catch {
      // Try the next connected device profile.
    }
  }

  throw new Error(`No Default.json profile found under ${profilesRoot}`);
}

function actionDefinition(slot) {
  const image = `plugins/${PLUGIN_DIRECTORY}/icons/codex.svg`;
  const state = {
    alignment: 'middle',
    background_colour: '#000000',
    colour: '#FFFFFF',
    family: 'Liberation Sans',
    image,
    image_scale: 100,
    name: '',
    show: true,
    size: 16,
    stroke_colour: '#000000',
    stroke_size: 3,
    style: 'Regular',
    text: '',
    underline: false
  };

  return {
    action: {
      controllers: ['Keypad'],
      disable_automatic_states: false,
      encoder: null,
      icon: image,
      name: 'Codex Status',
      plugin: PLUGIN_DIRECTORY,
      property_inspector: '',
      states: [state],
      supported_in_multi_actions: false,
      tooltip: 'Show whether a local Codex task is working or complete',
      uuid: PLUGIN_UUID,
      visible_in_action_list: true
    },
    children: null,
    context: `Keypad.${slot}.0`,
    current_state: 0,
    settings: {},
    states: [state]
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const configRoot = path.join(os.homedir(), '.config', 'opendeck');
  const sourcePlugin = path.join(root, 'dist', PLUGIN_DIRECTORY);
  const destinationPlugin = path.join(configRoot, 'plugins', PLUGIN_DIRECTORY);
  try {
    await readFile(path.join(sourcePlugin, 'manifest.json'));
  } catch {
    throw new Error('Packaged plugin not found. Run `npm install && npm run build` first.');
  }

  const profilePath = await findProfile(configRoot, options.profile);
  const profile = JSON.parse(await readFile(profilePath, 'utf8'));

  if (!Array.isArray(profile.keys)) throw new Error(`${profilePath} does not contain a key grid`);

  const existingSlot = profile.keys.findIndex((key) => key?.action?.uuid === PLUGIN_UUID);
  const slot = options.slot ?? (existingSlot >= 0 ? existingSlot : profile.keys.findIndex((key) => key === null));

  if (slot < 0 || slot >= profile.keys.length) {
    throw new Error('No empty key is available; pass --slot with a key to replace');
  }

  const existing = profile.keys[slot];
  if (existing && existing.action?.uuid !== PLUGIN_UUID) {
    throw new Error(`Key ${slot} is already assigned to ${existing.action?.name || 'another action'}`);
  }

  const stamp = new Date().toISOString().replaceAll(':', '-');
  const backupRoot = path.join(os.homedir(), '.local', 'state', 'streamdeck-dashboard', 'backups', stamp);
  await mkdir(backupRoot, { recursive: true });
  await writeFile(path.join(backupRoot, path.basename(profilePath)), JSON.stringify(profile, null, 2) + '\n');

  await rm(destinationPlugin, { recursive: true, force: true });
  await cp(sourcePlugin, destinationPlugin, { recursive: true });
  chmodSync(path.join(destinationPlugin, 'index.js'), 0o755);

  profile.keys[slot] = actionDefinition(slot);
  await writeFile(profilePath, JSON.stringify(profile, null, 2) + '\n');

  console.log(`Installed ${PLUGIN_DIRECTORY}`);
  console.log(`Profile: ${profilePath}`);
  console.log(`Key: ${slot}`);
  console.log(`Backup: ${backupRoot}`);
  console.log('Restart OpenDeck to load the plugin.');
}

await main();
