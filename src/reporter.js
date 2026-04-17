// @ts-check
const c = {
  reset: '\x1b[0m', gray: '\x1b[90m', red: '\x1b[31m', yellow: '\x1b[33m',
  green: '\x1b[32m', blue: '\x1b[34m', cyan: '\x1b[36m',
  bgRed: '\x1b[41;97m', bgYellow: '\x1b[43;30m', bgGreen: '\x1b[42;30m', bgBlue: '\x1b[44;97m',
};

export function renderReport({ stats, pressure, config, suggestion, cost }) {
  const pct = (pressure * 100).toFixed(1);
  const { warn, compact, critical } = config.thresholds;
  let bar, verdict;
  if (pressure >= critical) { bar = `${c.bgRed} CRITICAL ${c.reset}`; verdict = `${c.red}COMPACT NOW${c.reset}`; }
  else if (pressure >= compact) { bar = `${c.bgYellow} HIGH ${c.reset}`; verdict = `${c.yellow}COMPACT SOON${c.reset}`; }
  else if (pressure >= warn) { bar = `${c.bgBlue} WARN ${c.reset}`; verdict = `${c.blue}MONITOR${c.reset}`; }
  else { bar = `${c.bgGreen} OK ${c.reset}`; verdict = `${c.green}HEALTHY${c.reset}`; }

  const progressBar = renderBar(pressure);
  const costStr = cost ? `  ${c.gray}cost:${cost.formatted}${c.reset}` : '';

  const lines = [
    '',
    `${bar} ${verdict}  ${pct}%  ${progressBar}`,
    `${c.gray}tokens:${stats.totalTokens.toLocaleString()}  turns:${stats.turns}  u:${stats.breakdown.user}  a:${stats.breakdown.assistant}  t:${stats.breakdown.tools}${c.reset}${costStr}`,
  ];
  if (suggestion) lines.push(`${c.cyan}>> ${suggestion}${c.reset}`);
  lines.push('');
  return lines.join('\n');
}

function renderBar(pressure, width = 20) {
  const filled = Math.min(width, Math.round(pressure * width));
  const empty = width - filled;
  const color = pressure >= 0.9 ? c.red : pressure >= 0.75 ? c.yellow : pressure >= 0.6 ? c.blue : c.green;
  return `${color}${'█'.repeat(filled)}${c.gray}${'░'.repeat(empty)}${c.reset}`;
}

export function buildSuggestion(pressure, config) {
  const { compact, critical } = config.thresholds;
  const mode = config.compaction.mode;
  if (pressure >= critical) return mode === 'hybrid' || mode === 'auto' ? 'Run /compact now. Auto-trim armed.' : 'Run /compact immediately.';
  if (pressure >= compact) return mode === 'hybrid' ? 'Suggest /compact. Caveman mode on.' : 'Consider /compact.';
  return null;
}

/** Render a plan-limit bar (0-100 utilization) */
export function renderLimitBar(label, used, resetsAt, width = 18) {
  if (used === null || used === undefined) return `${c.gray}${label.padEnd(10)} —${c.reset}`;
  const pct = Math.max(0, Math.min(100, used));
  const filled = Math.round((pct / 100) * width);
  const empty = width - filled;
  const color = pct >= 90 ? c.red : pct >= 75 ? c.yellow : pct >= 50 ? c.blue : c.green;
  const resetTxt = resetsAt ? formatReset(resetsAt) : '—';
  return `${c.gray}${label.padEnd(10)}${c.reset} ${color}${'█'.repeat(filled)}${c.gray}${'░'.repeat(empty)}${c.reset} ${pct.toFixed(0).padStart(3)}%  reset:${resetTxt}`;
}

function formatReset(iso) {
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return 'now';
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  if (h >= 24) return `${Math.floor(h / 24)}d${h % 24}h`;
  if (h > 0) return `${h}h${m}m`;
  return `${m}m`;
}

/** Render the full plan-limits block */
export function renderPlanLimits(limits) {
  if (!limits?.available) {
    return `${c.gray}plan limits: unavailable (${limits?.reason || 'no-auth'})${c.reset}`;
  }
  const lines = [`${c.cyan}Plan limits (${limits.platform}):${c.reset}`];
  if (limits.session) lines.push('  ' + renderLimitBar(limits.session.label, limits.session.used, limits.session.resetsAt));
  if (limits.weekly)  lines.push('  ' + renderLimitBar(limits.weekly.label,  limits.weekly.used,  limits.weekly.resetsAt));
  if (limits.weeklyOpus && limits.weeklyOpus.used > 0) {
    lines.push('  ' + renderLimitBar(limits.weeklyOpus.label, limits.weeklyOpus.used, limits.weeklyOpus.resetsAt));
  }
  return lines.join('\n');
}
