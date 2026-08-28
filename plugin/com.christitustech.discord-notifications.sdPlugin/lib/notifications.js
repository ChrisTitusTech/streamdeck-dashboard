'use strict';

const HEADER_PATTERN = /^(?:method call|signal|method return|error)\b/;
const LAUNCHER_UPDATE_PATTERN =
  /interface=com\.canonical\.Unity\.LauncherEntry; member=Update\s*$/;
const STRING_PATTERN = /^\s+string "(.*)"\s*$/;
const INT64_PATTERN = /^\s+(?:variant\s+)?int64 (-?\d+)\s*$/;

function decodeDbusString(value) {
  try {
    return JSON.parse(`"${value}"`);
  } catch {
    return value;
  }
}

function isDiscordDesktopId(desktopId) {
  return /(?:^|[./_-])(?:discord|vesktop|webcord|armcord|equicord)(?:[./_-]|$)/i.test(
    String(desktopId)
  );
}

class LauncherBadgeParser {
  constructor(onCount) {
    this.onCount = onCount;
    this.remainder = '';
    this.resetRecord();
  }

  push(text) {
    const lines = `${this.remainder}${text}`.split('\n');
    this.remainder = lines.pop() || '';

    for (const line of lines) this.consumeLine(line);
  }

  consumeLine(line) {
    if (HEADER_PATTERN.test(line)) {
      this.resetRecord();
      this.readingUpdate = LAUNCHER_UPDATE_PATTERN.test(line);
      return;
    }

    if (!this.readingUpdate || this.emitted) return;

    const stringMatch = line.match(STRING_PATTERN);
    if (stringMatch) {
      const value = decodeDbusString(stringMatch[1]);
      if (this.desktopId === null) {
        this.desktopId = value;
      } else {
        this.currentKey = value;
      }
      return;
    }

    if (this.currentKey !== 'count') return;

    const countMatch = line.match(INT64_PATTERN);
    if (!countMatch) return;

    this.emitted = true;
    if (isDiscordDesktopId(this.desktopId)) {
      this.onCount(Math.max(0, Number(countMatch[1])));
    }
  }

  resetRecord() {
    this.currentKey = null;
    this.desktopId = null;
    this.emitted = false;
    this.readingUpdate = false;
  }
}

module.exports = { LauncherBadgeParser, isDiscordDesktopId };
