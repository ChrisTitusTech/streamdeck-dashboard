'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

test('ZIP CRC-32 implementation matches the standard check value', async () => {
  const { crc32 } = await import('../scripts/lib/zip.mjs');
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
});

test('ZIP timestamp encoding is fixed to UTC', async () => {
  const { dosTimestamp } = await import('../scripts/lib/zip.mjs');
  const timestamp = dosTimestamp(new Date('1980-01-01T00:00:00Z'));

  assert.deepEqual(timestamp, { day: 33, time: 0 });
});
