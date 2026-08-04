'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const SESSION_PATH_PATTERN =
  /\/sessions\/\d{4}\/\d{2}\/\d{2}\/rollout-.*\.jsonl(?: \(deleted\))?$/;
const DELETED_FILE_SUFFIX = ' (deleted)';
const UNKNOWN_TURN = '__unknown_turn__';

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
    if (
      !entry ||
      stat.size < entry.offset ||
      stat.dev !== entry.device ||
      stat.ino !== entry.inode
    ) {
      entry = {
        activeTurn: null,
        device: stat.dev,
        inode: stat.ino,
        offset: 0,
        remainder: ''
      };
      this.entries.set(filePath, entry);
    }

    if (stat.size > entry.offset) {
      let handle;

      try {
        handle = await this.fs.open(filePath, 'r');
        const chunks = [];

        while (entry.offset < stat.size) {
          const length = Math.min(stat.size - entry.offset, 64 * 1024);
          const buffer = Buffer.allocUnsafe(length);
          const { bytesRead } = await handle.read(
            buffer,
            0,
            length,
            entry.offset
          );

          if (bytesRead === 0) break;
          entry.offset += bytesRead;
          chunks.push(buffer.subarray(0, bytesRead));
        }

        this.#consume(entry, Buffer.concat(chunks).toString('utf8'));
      } catch {
        this.entries.delete(filePath);
        return false;
      } finally {
        if (handle) {
          try {
            await handle.close();
          } catch {
            // The owning process can close a descriptor while it is read.
          }
        }
      }
    }

    return entry.activeTurn !== null;
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
        // A Codex process runs one foreground turn at a time. A new start
        // supersedes an orphaned start left behind by a resume or interruption.
        entry.activeTurn = turnId || UNKNOWN_TURN;
      } else if (eventType === 'task_complete' || eventType === 'turn_aborted') {
        if (
          !turnId ||
          entry.activeTurn === UNKNOWN_TURN ||
          entry.activeTurn === turnId
        ) {
          entry.activeTurn = null;
        }
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
          const descriptorPath = path.join(fdPath, descriptor);
          const target = await fileSystem.readlink(descriptorPath);
          if (!SESSION_PATH_PATTERN.test(target)) continue;

          // A running Codex session can outlive its rollout directory entry.
          // Linux keeps the open descriptor readable, but marks its symlink
          // target with " (deleted)".
          sessions.push(
            target.endsWith(DELETED_FILE_SUFFIX) ? descriptorPath : target
          );
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

    const busyResults = await Promise.all(sessionPaths.map(async (filePath) => {
      try {
        return await this.tracker.isBusy(filePath);
      } catch {
        // A process or descriptor can disappear between discovery and reading.
        return false;
      }
    }));
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
