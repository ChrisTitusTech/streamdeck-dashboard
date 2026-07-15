#!/usr/bin/env node

'use strict';

const { CodexStatusMonitor } = require('./lib/status');
const { renderStatus } = require('./lib/render');

const WebSocketClient = globalThis.WebSocket || require('ws');

const ACTION_UUID = 'com.christitustech.codex-status.monitor';
const POLL_INTERVAL_MS = 1000;

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
    console.error('[Codex Status] Missing OpenDeck startup arguments');
    process.exit(1);
  }

  const monitor = new CodexStatusMonitor();
  const contexts = new Set();
  const lastImages = new Map();
  const socket = new WebSocketClient(`ws://127.0.0.1:${port}`);
  let polling = false;
  let timer = null;

  const send = (message) => {
    if (socket.readyState !== WebSocketClient.OPEN) return;
    socket.send(JSON.stringify(message));
  };

  const refresh = async () => {
    if (polling || contexts.size === 0) return;
    polling = true;

    try {
      const status = await monitor.getStatus();
      const image = renderStatus(status);

      for (const context of contexts) {
        if (lastImages.get(context) === image) continue;

        send({
          event: 'setImage',
          context,
          payload: {
            image,
            target: 0
          }
        });
        lastImages.set(context, image);
      }
    } catch (error) {
      console.warn('[Codex Status] Refresh failed:', error.message);
    } finally {
      polling = false;
    }
  };

  const startPolling = () => {
    if (timer) return;
    void refresh();
    timer = setInterval(() => void refresh(), POLL_INTERVAL_MS);
  };

  const stopPolling = () => {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
  };

  socket.addEventListener('open', () => {
    send({
      event: registerEvent,
      uuid: pluginUUID
    });
  });

  socket.addEventListener('message', (event) => {
    let message;

    try {
      message = JSON.parse(String(event.data));
    } catch (error) {
      console.warn('[Codex Status] Invalid OpenDeck message:', error.message);
      return;
    }

    if (message.action !== ACTION_UUID) return;

    if (message.event === 'willAppear') {
      contexts.add(message.context);
      lastImages.delete(message.context);
      startPolling();
      return;
    }

    if (message.event === 'willDisappear') {
      contexts.delete(message.context);
      lastImages.delete(message.context);
      if (contexts.size === 0) stopPolling();
      return;
    }

    if (message.event === 'keyDown') {
      lastImages.delete(message.context);
      void refresh();
    }
  });

  socket.addEventListener('error', (event) => {
    const detail = event.message || 'WebSocket connection error';
    console.warn('[Codex Status]', detail);
  });

  socket.addEventListener('close', () => {
    stopPolling();
    process.exit(0);
  });

  const shutdown = () => {
    stopPolling();
    socket.close();
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (require.main === module) start();

module.exports = { parseArgs, start };
