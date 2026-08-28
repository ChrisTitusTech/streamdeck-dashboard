'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  LauncherBadgeParser,
  isDiscordDesktopId
} = require('../plugin/com.christitustech.discord-notifications.sdPlugin/lib/notifications');

function badgeUpdate(desktopId, count) {
  return [
    "signal time=1 sender=:1.2 -> destination=(null destination) serial=9 path=/; interface=com.canonical.Unity.LauncherEntry; member=Update",
    `   string "${desktopId}"`,
    '   array [',
    '      dict entry(',
    '         string "count"',
    `         variant             int64 ${count}`,
    '      )',
    '      dict entry(',
    '         string "count-visible"',
    `         variant             boolean ${count !== 0}`,
    '      )',
    '   ]',
    ''
  ].join('\n');
}

test('recognizes common Discord desktop IDs', () => {
  for (const id of [
    'application://discord.desktop',
    'application://dev.vencord.Vesktop.desktop',
    'application://webcord.desktop',
    'application://armcord.desktop',
    'application://equicord.desktop'
  ]) {
    assert.equal(isDiscordDesktopId(id), true);
  }
  assert.equal(isDiscordDesktopId('application://thunderbird.desktop'), false);
  assert.equal(isDiscordDesktopId('application://notdiscord.desktop'), false);
});

test('reads the authoritative Vesktop badge count across partial chunks', () => {
  const counts = [];
  const parser = new LauncherBadgeParser((count) => counts.push(count));
  const record = badgeUpdate('application://dev.vencord.Vesktop.desktop', 3);

  parser.push(record.slice(0, 93));
  parser.push(record.slice(93));

  assert.deepEqual(counts, [3]);
});

test('tracks badge decreases and clear events', () => {
  const counts = [];
  const parser = new LauncherBadgeParser((count) => counts.push(count));

  parser.push(badgeUpdate('application://dev.vencord.Vesktop.desktop', 2));
  parser.push(badgeUpdate('application://dev.vencord.Vesktop.desktop', 1));
  parser.push(badgeUpdate('application://dev.vencord.Vesktop.desktop', 0));

  assert.deepEqual(counts, [2, 1, 0]);
});

test('ignores launcher badge updates from unrelated applications', () => {
  const counts = [];
  const parser = new LauncherBadgeParser((count) => counts.push(count));

  parser.push(badgeUpdate('application://slack.desktop', 4));

  assert.deepEqual(counts, []);
});
