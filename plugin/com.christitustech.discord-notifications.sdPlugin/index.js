#!/usr/bin/env node

'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { LauncherBadgeParser } = require('./lib/notifications');

const WebSocketClient = globalThis.WebSocket || require('ws');

const ACTION_UUID = 'com.christitustech.discord-notifications.monitor';
const DBUS_MATCH =
  "type='signal',interface='com.canonical.Unity.LauncherEntry',member='Update'";
const RESTART_DELAY_MS = 2000;
const STATE_DIRECTORY = path.join(
  process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state'),
  'opendeck'
);
const STATE_PATH = path.join(STATE_DIRECTORY, 'discord-notifications.json');

function loadCount() {
  try {
    const state = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
    return Number.isSafeInteger(state.count) && state.count >= 0
      ? state.count
      : 0;
  } catch {
    return 0;
  }
}

function saveCount(count) {
  try {
    fs.mkdirSync(STATE_DIRECTORY, { mode: 0o700, recursive: true });
    const temporaryPath = `${STATE_PATH}.${process.pid}.tmp`;
    fs.writeFileSync(temporaryPath, `${JSON.stringify({ count })}\n`, {
      mode: 0o600
    });
    fs.renameSync(temporaryPath, STATE_PATH);
  } catch (error) {
    console.warn('[Discord Notifications] Could not save badge count:', error.message);
  }
}

function parseArgs(argv) {
  const values = {};

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '-port') values.port = argv[index + 1];
    if (argument === '-pluginUUID') values.pluginUUID = argv[index + 1];
    if (argument === '-registerEvent') values.registerEvent = argv[index + 1];
  }

  return values;
}

function start() {
  const { port, pluginUUID, registerEvent } = parseArgs(process.argv.slice(2));

  if (!port || !pluginUUID || !registerEvent) {
    console.error('[Discord Notifications] Missing OpenDeck startup arguments');
    process.exit(1);
  }

  const socket = new WebSocketClient(`ws://127.0.0.1:${port}`);
  const contexts = new Set();
  let count = loadCount();
  let monitor = null;
  let restartTimer = null;
  let shuttingDown = false;

  const send = (message) => {
    if (socket.readyState !== WebSocketClient.OPEN) return;
    socket.send(JSON.stringify(message));
  };

  const updateTitles = () => {
    for (const context of contexts) {
      send({
        event: 'setTitle',
        context,
        payload: { target: 0, title: String(count) }
      });
    }
  };

  const parser = new LauncherBadgeParser((nextCount) => {
    if (count === nextCount) return;
    count = nextCount;
    saveCount(count);
    updateTitles();
  });

  const startMonitor = () => {
    if (monitor || shuttingDown || contexts.size === 0) return;

    const child = spawn('dbus-monitor', ['--session', DBUS_MATCH], {
      stdio: ['ignore', 'pipe', 'pipe']
    });
    monitor = child;

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => parser.push(chunk));
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      const detail = chunk.trim();
      if (detail) console.warn('[Discord Notifications]', detail);
    });

    child.on('error', (error) => {
      console.warn('[Discord Notifications] Monitor failed:', error.message);
    });

    child.on('close', () => {
      if (monitor !== child) return;
      monitor = null;
      if (!shuttingDown && contexts.size > 0) {
        restartTimer = setTimeout(() => {
          restartTimer = null;
          startMonitor();
        }, RESTART_DELAY_MS);
      }
    });
  };

  const stopMonitor = () => {
    if (restartTimer) {
      clearTimeout(restartTimer);
      restartTimer = null;
    }
    if (monitor) {
      const child = monitor;
      monitor = null;
      child.kill();
    }
  };

  const openDiscord = () => {
    try {
      const child = spawn('xdg-open', ['discord://-/channels/@me'], {
        detached: true,
        stdio: 'ignore'
      });
      child.on('error', (error) => {
        console.warn('[Discord Notifications] Could not open Discord:', error.message);
      });
      child.unref();
    } catch (error) {
      console.warn('[Discord Notifications] Could not open Discord:', error.message);
    }
  };

  socket.addEventListener('open', () => {
    send({ event: registerEvent, uuid: pluginUUID });
  });

  socket.addEventListener('message', (event) => {
    let message;

    try {
      message = JSON.parse(String(event.data));
    } catch (error) {
      console.warn('[Discord Notifications] Invalid OpenDeck message:', error.message);
      return;
    }

    if (message.action !== ACTION_UUID) return;

    if (message.event === 'willAppear') {
      contexts.add(message.context);
      updateTitles();
      startMonitor();
      return;
    }

    if (message.event === 'willDisappear') {
      contexts.delete(message.context);
      if (contexts.size === 0) stopMonitor();
      return;
    }

    if (message.event === 'keyDown') {
      openDiscord();
    }
  });

  socket.addEventListener('error', (event) => {
    console.warn('[Discord Notifications]', event.message || 'WebSocket error');
  });

  socket.addEventListener('close', () => {
    shuttingDown = true;
    stopMonitor();
    process.exit(0);
  });

  const shutdown = () => {
    shuttingDown = true;
    stopMonitor();
    socket.close();
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (require.main === module) start();

module.exports = { loadCount, parseArgs, saveCount, start };
