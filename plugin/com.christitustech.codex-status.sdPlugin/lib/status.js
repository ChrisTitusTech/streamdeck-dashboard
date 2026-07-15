'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const SESSION_PATH_PATTERN = /\/sessions\/\d{4}\/\d{2}\/\d{2}\/rollout-.*\.jsonl$/;

class SessionTracker {
  constructor(fileSystem = fs) {
    this.fs = fileSystem;
    this.entries = new Map();
  }

  async isBusy(filePath) {
    let stat;

    try {
      stat = await this.fs.stat(filePath);
    } catch {
      this.entries.delete(filePath);
      return false;
    }

    let entry = this.entries.get(filePath);
    if (!entry || stat.size < entry.offset) {
      entry = {
        activeTurns: new Set(),
        offset: 0,
        remainder: ''
      };
      this.entries.set(filePath, entry);
    }

    if (stat.size > entry.offset) {
      const handle = await this.fs.open(filePath, 'r');

      try {
        const length = stat.size - entry.offset;
        const buffer = Buffer.alloc(length);
        await handle.read(buffer, 0, length, entry.offset);
        entry.offset = stat.size;
        this.#consume(entry, buffer.toString('utf8'));
      } finally {
        await handle.close();
      }
    }

    return entry.activeTurns.size > 0;
  }

  forgetExcept(filePaths) {
    const activePaths = new Set(filePaths);
    for (const filePath of this.entries.keys()) {
      if (!activePaths.has(filePath)) this.entries.delete(filePath);
    }
  }

  #consume(entry, text) {
    const lines = `${entry.remainder}${text}`.split('\n');
    entry.remainder = lines.pop() || '';

    for (const line of lines) {
      if (!line) continue;

      let record;
      try {
        record = JSON.parse(line);
      } catch {
        continue;
      }

      if (record.type !== 'event_msg') continue;

      const eventType = record.payload?.type;
      const turnId = record.payload?.turn_id;

      if (eventType === 'task_started') {
        entry.activeTurns.add(turnId || '__unknown_turn__');
      } else if (eventType === 'task_complete') {
        if (turnId) entry.activeTurns.delete(turnId);
        else entry.activeTurns.clear();
      }
    }
  }
}

async function readText(fileSystem, filePath) {
  return String(await fileSystem.readFile(filePath, 'utf8')).trim();
}

async function findLiveCodexSessions(procRoot = '/proc', fileSystem = fs) {
  let processEntries;

  try {
    processEntries = await fileSystem.readdir(procRoot, { withFileTypes: true });
  } catch {
    return { processCount: 0, sessionPaths: [] };
  }

  const processIds = processEntries
    .filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name))
    .map((entry) => entry.name);

  const results = await Promise.all(processIds.map(async (processId) => {
    const processPath = path.join(procRoot, processId);

    try {
      if (await readText(fileSystem, path.join(processPath, 'comm')) !== 'codex') {
        return null;
      }

      const fdPath = path.join(processPath, 'fd');
      const fileDescriptors = await fileSystem.readdir(fdPath);
      const sessions = [];

      for (const descriptor of fileDescriptors) {
        try {
          const target = await fileSystem.readlink(path.join(fdPath, descriptor));
          if (SESSION_PATH_PATTERN.test(target)) sessions.push(target);
        } catch {
          // File descriptors can disappear while /proc is being read.
        }
      }

      return sessions;
    } catch {
      // Processes can exit while /proc is being read.
      return null;
    }
  }));

  const liveProcesses = results.filter((result) => result !== null);
  return {
    processCount: liveProcesses.length,
    sessionPaths: [...new Set(liveProcesses.flat())]
  };
}

class CodexStatusMonitor {
  constructor(options = {}) {
    this.fileSystem = options.fileSystem || fs;
    this.procRoot = options.procRoot || '/proc';
    this.tracker = options.tracker || new SessionTracker(this.fileSystem);
  }

  async getStatus() {
    const { processCount, sessionPaths } = await findLiveCodexSessions(
      this.procRoot,
      this.fileSystem
    );
    this.tracker.forgetExcept(sessionPaths);

    const busyResults = await Promise.all(
      sessionPaths.map((filePath) => this.tracker.isBusy(filePath))
    );
    const activeTasks = busyResults.filter(Boolean).length;

    if (activeTasks > 0) {
      return { state: 'working', activeTasks, processCount };
    }

    if (processCount > 0) {
      return { state: 'complete', activeTasks: 0, processCount };
    }

    return { state: 'offline', activeTasks: 0, processCount: 0 };
  }
}

module.exports = {
  CodexStatusMonitor,
  SessionTracker,
  findLiveCodexSessions
};
