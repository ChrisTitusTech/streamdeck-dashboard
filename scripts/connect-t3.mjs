#!/usr/bin/env node

import { createServer } from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import t3 from '../plugin/com.christitustech.codex-status.sdPlugin/lib/t3.js';

// Run once on the OpenDeck host. Tokens never go into the repository or stdout.
const runtimeFile = path.join(process.env.T3CODE_HOME || path.join(os.homedir(), '.t3'), 'userdata', 'server-runtime.json');
const args = process.argv.slice(2);
const options = { trustedLanHttp: false, includeLinked: true };
let requestedOrigin;
for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (arg === '--trusted-lan-http') options.trustedLanHttp = true;
  else if (arg === '--no-linked') options.includeLinked = false;
  else if (arg === '--pairing-code-file') {
    options.pairingCodeFile = args[++index];
    if (!options.pairingCodeFile) throw new Error('--pairing-code-file requires a path');
  } else if (arg.startsWith('-') || requestedOrigin) throw new Error('Unknown or duplicate argument');
  else requestedOrigin = arg;
}
const origin = requestedOrigin || JSON.parse(await readFile(runtimeFile, 'utf8')).origin;
const endpoint = t3.validateEndpoint(new URL('/mcp', origin).href, options);
const base = new URL(endpoint).origin;
async function json(url, options = {}) {
  const response = await fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`T3 connection failed (HTTP ${response.status})`);
  return response.json();
}
const metadata = await json(`${base}/.well-known/oauth-authorization-server`);
for (const field of ['registration_endpoint', 'authorization_endpoint', 'token_endpoint']) {
  if (new URL(metadata[field]).origin !== base) throw new Error('Unexpected OAuth endpoint');
}
const state = randomBytes(32).toString('base64url');
const verifier = randomBytes(32).toString('base64url');
let resolveCode;
let rejectCode;
const codePromise = new Promise((resolve, reject) => { resolveCode = resolve; rejectCode = reject; });
const server = createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  if (url.pathname !== '/callback' || url.searchParams.get('state') !== state) {
    response.writeHead(400).end('Invalid callback');
    return;
  }
  response.setHeader('Content-Type', 'text/plain');
  if (url.searchParams.has('error') || !url.searchParams.get('code')) {
    response.end('Connection declined. Return to the terminal.');
    rejectCode(new Error('T3 connection declined'));
  } else {
    response.end('Connected. Return to the terminal.');
    resolveCode(url.searchParams.get('code'));
  }
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
const timer = setTimeout(() => rejectCode(new Error('T3 approval timed out')), 300000);
try {
  const redirectUri = `http://127.0.0.1:${server.address().port}/callback`;
  const client = await json(metadata.registration_endpoint, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_name: 'Codex Status for OpenDeck', redirect_uris: [redirectUri], token_endpoint_auth_method: 'none', grant_types: ['authorization_code'], response_types: ['code'] })
  });
  const authorization = new URL(metadata.authorization_endpoint);
  authorization.search = new URLSearchParams({
    client_id: client.client_id, redirect_uri: redirectUri, response_type: 'code',
    state, code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256', resource: endpoint, scope: 'orchestration:read'
  }).toString();
  if (options.pairingCodeFile) {
    const pairingCode = (await readFile(options.pairingCodeFile, 'utf8')).trim();
    if (!pairingCode) throw new Error('Pairing code file is empty');
    const result = await json(`${base}/oauth/mcp/decision`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        authorization: Object.fromEntries(authorization.searchParams),
        decision: { _tag: 'pairing-code', access: 'read-only', code: pairingCode }
      })
    });
    const callback = new URL(result.redirectTo);
    const expected = new URL(redirectUri);
    if (callback.origin !== expected.origin || callback.pathname !== expected.pathname ||
        callback.searchParams.get('state') !== state || !callback.searchParams.get('code')) {
      throw new Error('Invalid T3 approval callback');
    }
    resolveCode(callback.searchParams.get('code'));
  } else {
    console.log(`Open this URL on this machine and approve READ-ONLY access:\n${authorization.href}`);
  }
  const code = await codePromise;
  const credentials = await json(metadata.token_endpoint, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', client_id: client.client_id, redirect_uri: redirectUri, code, code_verifier: verifier, resource: endpoint })
  });
  if (typeof credentials.access_token !== 'string' || !credentials.access_token) throw new Error('No access token');
  const monitor = new t3.McpClient(endpoint, credentials.access_token, options);
  await monitor.call('t3_environment_read');
  const directory = path.dirname(t3.CONFIG_PATH);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  let config = { sources: [] };
  try { config = JSON.parse(await readFile(t3.CONFIG_PATH, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!Array.isArray(config.sources)) throw new Error('Invalid existing T3 config');
  const tokenFile = `token-${createHash('sha256').update(endpoint).digest('hex').slice(0, 16)}`;
  await writeFile(path.join(directory, tokenFile), credentials.access_token, { mode: 0o600 });
  await chmod(path.join(directory, tokenFile), 0o600);
  config.sources = config.sources.filter((source) => source.endpoint !== endpoint);
  config.sources.push({ endpoint, tokenFile, includeLinked: options.includeLinked, ...(options.trustedLanHttp ? { trustedLanHttp: true } : {}) });
  await writeFile(t3.CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  await chmod(t3.CONFIG_PATH, 0o600);
  console.log(`Saved T3 connection to ${t3.CONFIG_PATH}. Press the Stream Deck key to refresh.`);
} finally {
  clearTimeout(timer);
  server.closeAllConnections();
  server.close();
}
