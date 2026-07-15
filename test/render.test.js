'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  getDisplay,
  renderStatus
} = require('../plugin/com.christitustech.codex-status.sdPlugin/lib/render');

test('working display includes the active task count', () => {
  assert.deepEqual(getDisplay({ state: 'working', activeTasks: 2, processCount: 2 }), {
    accent: '#f59e0b',
    detail: '2 ACTIVE TASKS',
    label: 'WORKING'
  });
});

test('renderStatus returns an SVG data URL', () => {
  const result = renderStatus({ state: 'complete', activeTasks: 0, processCount: 1 });
  assert.match(result, /^data:image\/svg\+xml;base64,/);

  const svg = Buffer.from(result.split(',')[1], 'base64').toString('utf8');
  assert.match(svg, /COMPLETE/);
  assert.match(svg, /CODEX READY/);
});
