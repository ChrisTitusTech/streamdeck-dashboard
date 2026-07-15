'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

test('ZIP CRC-32 implementation matches the standard check value', async () => {
  const { crc32 } = await import('../scripts/lib/zip.mjs');
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
});
