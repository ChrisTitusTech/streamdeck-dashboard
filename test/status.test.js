'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  CodexStatusMonitor,
  SessionTracker,
  findLiveCodexSessions
} = require('../plugin/com.christitustech.codex-status.sdPlugin/lib/status');

async function makeFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-status-'));
  const procRoot = path.join(root, 'proc');
  const sessionRoot = path.join(root, 'home', '.codex', 'sessions', '2026', '07', '14');
  const sessionPath = path.join(sessionRoot, 'rollout-test.jsonl');
  const processPath = path.join(procRoot, '123', 'fd');

  await fs.mkdir(sessionRoot, { recursive: true });
  await fs.mkdir(processPath, { recursive: true });
  await fs.writeFile(path.join(procRoot, '123', 'comm'), 'codex\n');
  await fs.writeFile(sessionPath, '');
  await fs.symlink(sessionPath, path.join(processPath, '9'));

  return { procRoot, root, sessionPath };
}

async function makeDeletedRolloutFixture() {
  const fixture = await makeFixture();
  const descriptorPath = path.join(fixture.procRoot, '123', 'fd', '9');
  const handle = await fs.open(fixture.sessionPath, 'a+');

  await fs.rm(descriptorPath);
  await fs.rm(fixture.sessionPath);
  await fs.symlink(`/proc/self/fd/${handle.fd}`, descriptorPath);

  const fileSystem = new Proxy(fs, {
    get(target, property) {
      if (property === 'readlink') {
        return async (filePath) => {
          if (filePath === descriptorPath) {
            return `${fixture.sessionPath} (deleted)`;
          }
          return target.readlink(filePath);
        };
      }
      return target[property];
    }
  });

  return { ...fixture, descriptorPath, fileSystem, handle };
}

function event(type, turnId = 'turn-1') {
  return JSON.stringify({
    type: 'event_msg',
    payload: { type, turn_id: turnId }
  }) + '\n';
}

test('findLiveCodexSessions maps a live Codex process to its open rollout', async (t) => {
  const fixture = await makeFixture();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));

  assert.deepEqual(await findLiveCodexSessions(fixture.procRoot), {
    processCount: 1,
    sessionPaths: [fixture.sessionPath]
  });
});

test('SessionTracker follows appended task lifecycle events', async (t) => {
  const fixture = await makeFixture();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
  const tracker = new SessionTracker();

  await fs.appendFile(fixture.sessionPath, event('task_started'));
  assert.equal(await tracker.isBusy(fixture.sessionPath), true);

  await fs.appendFile(fixture.sessionPath, event('task_complete'));
  assert.equal(await tracker.isBusy(fixture.sessionPath), false);
});

test('SessionTracker clears an aborted turn without leaving stale work', async (t) => {
  const fixture = await makeFixture();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
  const tracker = new SessionTracker();

  await fs.appendFile(fixture.sessionPath, event('task_started', 'aborted-turn'));
  assert.equal(await tracker.isBusy(fixture.sessionPath), true);

  await fs.appendFile(fixture.sessionPath, event('turn_aborted', 'aborted-turn'));
  assert.equal(await tracker.isBusy(fixture.sessionPath), false);

  await fs.appendFile(fixture.sessionPath, event('task_started', 'next-turn'));
  await fs.appendFile(fixture.sessionPath, event('task_complete', 'next-turn'));
  assert.equal(await tracker.isBusy(fixture.sessionPath), false);
});

test('CodexStatusMonitor follows a deleted rollout through its open descriptor', async (t) => {
  const fixture = await makeDeletedRolloutFixture();
  t.after(async () => {
    await fixture.handle.close();
    await fs.rm(fixture.root, { recursive: true, force: true });
  });
  const monitor = new CodexStatusMonitor({
    fileSystem: fixture.fileSystem,
    procRoot: fixture.procRoot
  });

  await fixture.handle.write(event('task_started'));
  assert.deepEqual(await monitor.getStatus(), {
    state: 'working',
    activeTasks: 1,
    processCount: 1
  });

  await fixture.handle.write(event('task_complete'));
  assert.deepEqual(await monitor.getStatus(), {
    state: 'complete',
    activeTasks: 0,
    processCount: 1
  });
});

test('CodexStatusMonitor reports working, complete, then offline', async (t) => {
  const fixture = await makeFixture();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
  const monitor = new CodexStatusMonitor({ procRoot: fixture.procRoot });

  await fs.appendFile(fixture.sessionPath, event('task_started'));
  assert.deepEqual(await monitor.getStatus(), {
    state: 'working',
    activeTasks: 1,
    processCount: 1
  });

  await fs.appendFile(fixture.sessionPath, event('task_complete'));
  assert.deepEqual(await monitor.getStatus(), {
    state: 'complete',
    activeTasks: 0,
    processCount: 1
  });

  await fs.rm(path.join(fixture.procRoot, '123'), { recursive: true, force: true });
  assert.deepEqual(await monitor.getStatus(), {
    state: 'offline',
    activeTasks: 0,
    processCount: 0
  });
});
