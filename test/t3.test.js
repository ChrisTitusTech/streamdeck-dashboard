'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { McpClient, T3StatusMonitor, CombinedStatusMonitor, validateEndpoint } = require('../plugin/com.christitustech.codex-status.sdPlugin/lib/t3');
const { renderStatus } = require('../plugin/com.christitustech.codex-status.sdPlugin/lib/render');

function monitor(call, config = { sources: [{ endpoint: 'http://127.0.0.1:3000/mcp', tokenFile: 'token' }] }) {
  return new T3StatusMonitor({
    configPath: '/fake/t3.json',
    fileSystem: { readFile: async (file) => file.endsWith('.json') ? JSON.stringify(config) : 'secret' },
    createClient: () => ({ call })
  });
}
const identity = { environmentId: 'local', label: 'Desktop' };
const thread = (threadId, status, extra = {}) => ({ threadId, status, ...extra });

test('discovers all machines, paginates, includes providers and subagents, deduplicates sources', async () => {
  const calls = [];
  const m = monitor(async (name, args) => {
    calls.push([name, args]);
    if (name === 't3_environment_read') return identity;
    if (name === 't3_environment_links') return { links: [{ environmentId: 'vps', label: 'VPS' }] };
    assert.equal(args.allProjects, true);
    assert.equal(args.includeSubagents, true);
    if (args.environmentId === 'local') return { threads: [thread('a', 'completed')], nextCursor: null };
    return args.cursor === 0
      ? { threads: [thread('b', 'running', { providerInstanceId: 'claude' })], nextCursor: 100 }
      : { threads: [thread('b', 'running'), thread('c', 'waiting', { parentThreadId: 'b' })], nextCursor: null };
  }, { sources: [1, 2].map(() => ({ endpoint: 'http://localhost/mcp', tokenFile: 'token' })) });
  const result = await m.getStatus();
  assert.equal(result.activeTasks, 2);
  assert.equal(result.environments.length, 2);
  assert.equal(result.errors, 0);
  assert.equal(calls.filter(([name]) => name === 't3_thread_list').length, 3);
});

test('failed remote does not hide local work and is never reported as complete', async () => {
  const m = monitor(async (name, args) => {
    if (name === 't3_environment_read') return identity;
    if (name === 't3_environment_links') return { links: [{ environmentId: 'vps' }] };
    if (args.environmentId === 'vps') throw new Error('offline');
    return { threads: [], nextCursor: null };
  });
  const combined = new CombinedStatusMonitor({ getStatus: async () => ({ state: 'complete', activeTasks: 0, processCount: 1 }) }, m);
  const result = await combined.getStatus();
  assert.equal(result.state, 'unknown');
  assert.equal(result.t3.errors, 1);
  assert.match(Buffer.from(renderStatus(result).split(',')[1], 'base64').toString(), /UNKNOWN/);
});

test('combined counts do not double count local Codex processes', async () => {
  const result = await new CombinedStatusMonitor(
    { getStatus: async () => ({ state: 'working', activeTasks: 1, processCount: 1 }) },
    { getStatus: async () => ({ configured: true, activeTasks: 1, errors: 0, environments: [{ activeTasks: 1 }] }) }
  ).getStatus();
  assert.equal(result.activeTasks, 1);
  const svg = Buffer.from(renderStatus(result).split(',')[1], 'base64').toString();
  assert.match(svg, /1 T3 \/ 1 LOCAL/);
  assert.match(svg, /1\/1 MACHINES BUSY/);
});

test('optional missing config preserves original Codex behavior; malformed config is an error', async () => {
  const m = new T3StatusMonitor({ fileSystem: { readFile: async () => { throw Object.assign(new Error(), { code: 'ENOENT' }); } } });
  assert.equal((await m.getStatus()).configured, false);
  assert.equal((await monitor(() => {}, {}).getStatus()).errors, 1);
});

test('repeated cursor is a source error rather than an infinite poll', async () => {
  const result = await monitor(async (name) => {
    if (name === 't3_environment_read') return identity;
    if (name === 't3_environment_links') return { links: [] };
    return { threads: [], nextCursor: 0 };
  }).getStatus();
  assert.equal(result.errors, 1);
});

test('MCP initializes, handles SSE, and reconnects after a stale session', async () => {
  const calls = [];
  let fail = false;
  const client = new McpClient('http://localhost/mcp', 'secret', { fetch: async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push(body);
    assert.equal(options.redirect, 'error');
    if (fail) { fail = false; return new Response('', { status: 404 }); }
    if (body.method === 'initialize') return new Response(JSON.stringify({ result: {} }), { headers: { 'mcp-session-id': 'session' } });
    if (body.method === 'notifications/initialized') return new Response(null, { status: 202 });
    assert.equal(options.headers['Mcp-Session-Id'], 'session');
    return new Response(`event: message\ndata: ${JSON.stringify({ result: { structuredContent: identity } })}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });
  } });
  assert.deepEqual(await client.call('t3_environment_read'), identity);
  fail = true;
  await assert.rejects(client.call('t3_environment_read'));
  assert.deepEqual(await client.call('t3_environment_read'), identity);
  assert.equal(calls.filter((call) => call.method === 'initialize').length, 2);
});

test('refuses remote cleartext and URLs containing credentials', () => {
  for (const url of ['http://vps/mcp', 'https://user:secret@vps/mcp', 'file:///tmp/key', 'https://vps/mcp?token=secret']) {
    assert.throws(() => validateEndpoint(url));
  }
  assert.equal(validateEndpoint('https://vps/mcp'), 'https://vps/mcp');
});

test('busy machine labels rotate and XML is escaped', () => {
  const status = { state: 'working', activeTasks: 2, localActiveTasks: 0, processCount: 0,
    t3: { activeTasks: 2, errors: 0, environments: [{ label: 'VPS & <dev>', activeTasks: 2 }] } };
  const svg = Buffer.from(renderStatus(status, 3).split(',')[1], 'base64').toString();
  assert.match(svg, /VPS &amp; &lt;dev&gt;: 2/);
});

test('known remote work stays working with visible errors when another source fails', async () => {
  const result = await new CombinedStatusMonitor(
    { getStatus: async () => ({ state: 'offline', activeTasks: 0, processCount: 0 }) },
    { getStatus: async () => ({ configured: true, activeTasks: 3, errors: 1, environments: [{ activeTasks: 3 }] }) }
  ).getStatus();
  assert.equal(result.state, 'working');
  assert.match(Buffer.from(renderStatus(result).split(',')[1], 'base64').toString(), /SOURCE ERRORS/);
});


test('trusted LAN HTTP requires an explicit boolean opt-in at validation and client construction', () => {
  const endpoint = 'http://10.0.0.92:3773/mcp';
  assert.throws(() => validateEndpoint(endpoint));
  assert.throws(() => validateEndpoint(endpoint, { trustedLanHttp: 'true' }));
  assert.equal(validateEndpoint(endpoint, { trustedLanHttp: true }), endpoint);
  assert.throws(() => new McpClient(endpoint, 'test-token'));
  assert.equal(new McpClient(endpoint, 'test-token', { trustedLanHttp: true }).endpoint, endpoint);
  assert.throws(() => validateEndpoint('http://user:password@10.0.0.92/mcp', { trustedLanHttp: true }));
});

test('monitor passes trusted LAN opt-in to client and supports direct sources without linked discovery', async () => {
  let called = false;
  const m = new T3StatusMonitor({
    configPath: '/fake/t3.json',
    fileSystem: { readFile: async (file) => file.endsWith('.json')
      ? JSON.stringify({ sources: [{ endpoint: 'http://10.0.0.92:3773/mcp', tokenFile: 'token', trustedLanHttp: true, includeLinked: false }] }) : 'secret' },
    createClient: (endpoint, token, options) => {
      called = true;
      assert.equal(options.trustedLanHttp, true);
      return { call: async (name) => {
        if (name === 't3_environment_read') return { environmentId: 'windows', label: 'win11-passthrough' };
        assert.equal(name, 't3_thread_list');
        return { threads: [{ threadId: 'a', status: 'running' }], nextCursor: null };
      } };
    }
  });
  const result = await m.getStatus();
  assert.equal(called, true);
  assert.equal(result.activeTasks, 1);
  assert.equal(result.errors, 0);
});
