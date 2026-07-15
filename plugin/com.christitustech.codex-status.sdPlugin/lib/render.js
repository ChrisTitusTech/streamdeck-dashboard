'use strict';

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function getDisplay(status) {
  if (status.state === 'working') {
    return {
      accent: '#f59e0b',
      detail: status.activeTasks === 1 ? '1 ACTIVE TASK' : `${status.activeTasks} ACTIVE TASKS`,
      label: 'WORKING'
    };
  }

  if (status.state === 'complete') {
    return {
      accent: '#22c55e',
      detail: status.processCount === 1 ? 'CODEX READY' : `${status.processCount} SESSIONS READY`,
      label: 'COMPLETE'
    };
  }

  return {
    accent: '#71717a',
    detail: 'NO PROCESS',
    label: 'OFFLINE'
  };
}

function renderStatus(status) {
  const display = getDisplay(status);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
  <rect width="144" height="144" rx="12" fill="#18181b"/>
  <circle cx="72" cy="32" r="17" fill="none" stroke="${display.accent}" stroke-width="5"/>
  <path d="M62 32h20M72 22v20" stroke="${display.accent}" stroke-width="4" stroke-linecap="round"/>
  <text x="72" y="65" fill="#a1a1aa" font-family="sans-serif" font-size="13" font-weight="700" text-anchor="middle">CODEX</text>
  <text x="72" y="94" fill="${display.accent}" font-family="sans-serif" font-size="19" font-weight="800" text-anchor="middle">${escapeXml(display.label)}</text>
  <text x="72" y="119" fill="#d4d4d8" font-family="sans-serif" font-size="10" font-weight="600" text-anchor="middle">${escapeXml(display.detail)}</text>
  <circle cx="72" cy="132" r="3" fill="${display.accent}"/>
</svg>`;

  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

module.exports = { getDisplay, renderStatus };
