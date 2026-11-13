'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const CONFIG_PATH = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'codex-status', 't3.json');
const ACTIVE_STATES = new Set(['preparing', 'queued', 'starting', 'running', 'waiting']);

function validateEndpoint(value, options = {}) {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash ||
      (url.protocol !== 'https:' && !(url.protocol === 'http:' &&
        (options.trustedLanHttp === true || ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))))) {
    throw new Error('T3 endpoint requires HTTPS, loopback HTTP, or explicit trustedLanHttp opt-in');
  }
  return url.href.replace(/\/$/, '');
}

class McpClient {
  constructor(endpoint, token, options = {}) {
    this.endpoint = validateEndpoint(endpoint, options);
    this.token = token;
    this.fetch = options.fetch || globalThis.fetch;
    this.timeoutMs = options.timeoutMs || 5000;
    this.sessionId = null;
    this.id = 0;
  }

  async request(method, params, notification = false) {
    const response = await this.fetch(this.endpoint, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(this.timeoutMs),
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${this.token}`,
        'MCP-Protocol-Version': '2025-06-18',
        ...(this.sessionId ? { 'Mcp-Session-Id': this.sessionId } : {})
      },
      body: JSON.stringify({ jsonrpc: '2.0', ...(!notification ? { id: ++this.id } : {}), method, params })
    });
    if (!response.ok) {
      if (response.status === 404) this.sessionId = null;
      throw new Error(`T3 HTTP ${response.status}`);
    }
    const session = response.headers.get('mcp-session-id');
    if (session) this.sessionId = session;
    if (notification) {
      await response.body?.cancel();
      return;
    }
    // T3 returns one JSON response, either directly or wrapped in an SSE event.
    const body = await response.text();
    const json = response.headers.get('content-type')?.includes('text/event-stream')
      ? body.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('\n')
      : body;
    const message = JSON.parse(json);
    if (message.error || !message.result) throw new Error('T3 RPC failed');
    return message.result;
  }

  async call(name, args = {}) {
    if (!this.sessionId) {
      await this.request('initialize', {
        protocolVersion: '2025-06-18', capabilities: {},
        clientInfo: { name: 'codex-status', version: '1.1.0' }
      });
      if (!this.sessionId) throw new Error('T3 did not establish a session');
      await this.request('notifications/initialized', {}, true);
    }
    const result = await this.request('tools/call', { name, arguments: args });
    if (result.isError) throw new Error('T3 tool unavailable or access denied');
    const data = result.structuredContent ?? JSON.parse(result.content?.find((part) => part.type === 'text')?.text || 'null');
    if (!data) throw new Error('Invalid T3 tool result');
    return data;
  }
}

class T3StatusMonitor {
  constructor(options = {}) {
    this.configPath = options.configPath || CONFIG_PATH;
    this.fs = options.fileSystem || fs;
    this.createClient = options.createClient || ((endpoint, token, clientOptions) => new McpClient(endpoint, token, clientOptions));
    this.clients = new Map();
  }

  async getStatus() {
    let config;
    try {
      config = JSON.parse(await this.fs.readFile(this.configPath, 'utf8'));
      if (!Array.isArray(config.sources) || config.sources.length === 0) throw new Error('No sources');
    } catch (error) {
      if (error.code === 'ENOENT') return { configured: false, environments: [], activeTasks: 0, errors: 0 };
      return { configured: true, environments: [], activeTasks: 0, errors: 1 };
    }
    const seen = new Set();
    const environments = [];
    let errors = 0;
    const clientKeys = new Set();
    // Sources and their peers are polled independently, so a failed machine
    // cannot hide successful observations from the others.
    for (const source of config.sources) {
      try {
        const endpoint = validateEndpoint(source.endpoint, source);
        const token = (await this.fs.readFile(path.resolve(path.dirname(this.configPath), source.tokenFile), 'utf8')).trim();
        if (!token) throw new Error('Missing token');
        const key = `${endpoint}\n${token}`;
        clientKeys.add(key);
        if (!this.clients.has(key)) this.clients.set(key, this.createClient(endpoint, token, { trustedLanHttp: source.trustedLanHttp === true }));
        const client = this.clients.get(key);
        const identity = await client.call('t3_environment_read');
        if (typeof identity.environmentId !== 'string') throw new Error('Missing environment id');
        const targets = [{ environmentId: identity.environmentId, label: identity.label || source.label || 'T3 Code' }];
        if (source.includeLinked !== false) {
          try {
            const result = await client.call('t3_environment_links');
            if (!Array.isArray(result.links)) throw new Error('Missing links');
            targets.push(...result.links);
          } catch {
            errors += 1;
          }
        }
        await Promise.all([...new Map(targets.map((target) => [target.environmentId, target])).values()].map(async (target) => {
          if (typeof target.environmentId !== 'string') { errors += 1; return; }
          if (seen.has(target.environmentId)) return;
          try {
            const tasks = new Map();
            let cursor = 0;
            const cursors = new Set();
            do {
              if (cursors.has(cursor)) throw new Error('Repeated pagination cursor');
              cursors.add(cursor);
              const page = await client.call('t3_thread_list', {
                environmentId: target.environmentId, allProjects: true,
                includeSubagents: true, limit: 100, cursor
              });
              if (!Array.isArray(page.threads) || !(page.nextCursor === null || Number.isInteger(page.nextCursor))) {
                throw new Error('Invalid thread list');
              }
              for (const thread of page.threads) {
                if (typeof thread.threadId !== 'string' || typeof thread.status !== 'string') throw new Error('Invalid thread');
                if (ACTIVE_STATES.has(thread.status)) tasks.set(thread.threadId, thread.status);
              }
              cursor = page.nextCursor;
            } while (cursor !== null);
            seen.add(target.environmentId);
            environments.push({ id: target.environmentId, label: target.label || 'T3 Code', activeTasks: tasks.size });
          } catch {
            errors += 1;
          }
        }));
      } catch {
        errors += 1;
      }
    }
    for (const key of this.clients.keys()) if (!clientKeys.has(key)) this.clients.delete(key);
    return { configured: true, environments, activeTasks: environments.reduce((sum, env) => sum + env.activeTasks, 0), errors };
  }
}

class CombinedStatusMonitor {
  constructor(codex, t3 = new T3StatusMonitor()) {
    this.codex = codex;
    this.t3 = t3;
  }

  async getStatus() {
    const [codex, t3] = await Promise.all([this.codex.getStatus(), this.t3.getStatus()]);
    if (!t3.configured) return codex;
    // Local Codex processes may also belong to T3. Display the two source
    // counts separately instead of claiming they are distinct tasks.
    const working = codex.activeTasks > 0 || t3.activeTasks > 0;
    return {
      ...codex,
      state: working ? 'working' : t3.errors ? 'unknown' : t3.environments.length ? 'complete' : codex.state,
      t3,
      localActiveTasks: codex.activeTasks,
      activeTasks: Math.max(codex.activeTasks, t3.activeTasks)
    };
  }
}

module.exports = { CONFIG_PATH, ACTIVE_STATES, validateEndpoint, McpClient, T3StatusMonitor, CombinedStatusMonitor };
