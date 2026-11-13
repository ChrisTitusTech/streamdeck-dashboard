'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { mkdtemp, readFile, stat, rm } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');

test('connection setup completes OAuth PKCE and saves private config without printing tokens', { timeout: 10000 }, async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'codex-t3-connect-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let origin;
  let challenge;
  let redirectUri;
  const server = http.createServer(async (req, res) => {
    try {
      let body = '';
      for await (const chunk of req) body += chunk;
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/.well-known/oauth-authorization-server') {
        return res.end(JSON.stringify({ registration_endpoint: `${origin}/register`, authorization_endpoint: `${origin}/authorize`, token_endpoint: `${origin}/token` }));
      }
      if (req.url === '/register') {
        redirectUri = JSON.parse(body).redirect_uris[0];
        return res.end(JSON.stringify({ client_id: 'client' }));
      }
      if (req.url === '/token') {
        const params = new URLSearchParams(body);
        assert.equal(params.get('code'), 'approved-code');
        assert.equal(params.get('redirect_uri'), redirectUri);
        assert.equal(createHash('sha256').update(params.get('code_verifier')).digest('base64url'), challenge);
        return res.end(JSON.stringify({ access_token: 'test-private-token' }));
      }
      assert.equal(req.headers.authorization, 'Bearer test-private-token');
      const message = JSON.parse(body);
      if (message.method === 'initialize') {
        res.setHeader('mcp-session-id', 'test-session');
        return res.end(JSON.stringify({ result: { protocolVersion: '2025-06-18' } }));
      }
      if (message.method === 'notifications/initialized') { res.writeHead(202); return res.end(); }
      assert.equal(message.params.name, 't3_environment_read');
      res.end(JSON.stringify({ result: { structuredContent: { environmentId: 'test' } } }));
    } catch (error) {
      res.writeHead(500); res.end('{}');
      assert.fail(error.message);
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  t.after(() => { server.closeAllConnections(); server.close(); });
  const child = spawn(process.execPath, ['scripts/connect-t3.mjs', origin], { env: { ...process.env, XDG_CONFIG_HOME: directory }, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => child.kill());
  let output = '';
  let callback;
  child.stdout.on('data', (chunk) => {
    output += chunk;
    const match = output.match(/http:\/\/127\.0\.0\.1:\d+\/authorize\?[^\s]+/);
    if (match && !callback) {
      const auth = new URL(match[0]);
      assert.equal(auth.searchParams.get('scope'), 'orchestration:read');
      challenge = auth.searchParams.get('code_challenge');
      callback = new URL(auth.searchParams.get('redirect_uri'));
      callback.search = new URLSearchParams({ state: auth.searchParams.get('state'), code: 'approved-code' }).toString();
      void fetch(callback).then((response) => response.text());
    }
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const exit = await new Promise((resolve) => child.once('exit', resolve));
  assert.equal(exit, 0, stderr);
  assert.doesNotMatch(output, /test-private-token/);
  const config = JSON.parse(await readFile(path.join(directory, 'codex-status', 't3.json'), 'utf8'));
  assert.equal(config.sources[0].endpoint, `${origin}/mcp`);
  const tokenPath = path.join(directory, 'codex-status', config.sources[0].tokenFile);
  assert.equal(await readFile(tokenPath, 'utf8'), 'test-private-token');
  assert.equal((await stat(tokenPath)).mode & 0o777, 0o600);
});
