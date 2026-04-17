// @ts-check
// Fetch plan usage limits (5h session + weekly) from Claude Code and Codex CLI.
// Uses local OAuth tokens stored by the CLIs themselves.
//
// IMPORTANT: endpoints below are INTERNAL / UNDOCUMENTED.
// They work today but may break if Anthropic/OpenAI change them.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';

const CLAUDE_USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const CODEX_USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage';

/** Read Claude Code OAuth token from macOS Keychain or ~/.claude/ on Linux */
function getClaudeToken() {
  // macOS: Keychain
  if (process.platform === 'darwin') {
    try {
      const raw = execSync('security find-generic-password -s "Claude Code-credentials" -w', {
        stdio: ['ignore', 'pipe', 'ignore']
      }).toString().trim();
      const creds = JSON.parse(raw);
      return creds.claudeAiOauth?.accessToken || null;
    } catch { /* fall through */ }
  }
  // Linux / fallback: check credentials file
  const credsFile = path.join(os.homedir(), '.claude', '.credentials.json');
  if (fs.existsSync(credsFile)) {
    try {
      const creds = JSON.parse(fs.readFileSync(credsFile, 'utf-8'));
      return creds.claudeAiOauth?.accessToken || null;
    } catch { /* ignore */ }
  }
  return null;
}

/** Read Codex CLI auth token + account-id from ~/.codex/auth.json */
function getCodexAuth() {
  const authFile = path.join(os.homedir(), '.codex', 'auth.json');
  if (!fs.existsSync(authFile)) return null;
  try {
    const auth = JSON.parse(fs.readFileSync(authFile, 'utf-8'));
    const token = auth.tokens?.access_token || auth.OPENAI_API_KEY || null;
    const accountId = auth.tokens?.account_id || auth.account_id || null;
    return token ? { token, accountId } : null;
  } catch { return null; }
}

export async function fetchClaudeLimits() {
  const token = getClaudeToken();
  if (!token) return { available: false, reason: 'no-token' };
  try {
    const res = await fetch(CLAUDE_USAGE_URL, {
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'claude-code/2.0.32',
        'Authorization': `Bearer ${token}`,
        'anthropic-beta': 'oauth-2025-04-20',
      }
    });
    if (!res.ok) return { available: false, reason: `http-${res.status}` };
    const data = await res.json();
    return {
      available: true,
      platform: 'claude-code',
      session: data.five_hour ? {
        used: data.five_hour.utilization,       // 0-100
        resetsAt: data.five_hour.resets_at,
        label: '5-hour'
      } : null,
      weekly: data.seven_day ? {
        used: data.seven_day.utilization,
        resetsAt: data.seven_day.resets_at,
        label: '7-day'
      } : null,
      weeklyOpus: data.seven_day_opus ? {
        used: data.seven_day_opus.utilization,
        resetsAt: data.seven_day_opus.resets_at,
        label: '7-day Opus'
      } : null,
    };
  } catch (e) {
    return { available: false, reason: `error:${e.message}` };
  }
}

export async function fetchCodexLimits() {
  const auth = getCodexAuth();
  if (!auth) return { available: false, reason: 'no-token' };
  try {
    const headers = {
      'Authorization': `Bearer ${auth.token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'codex-cli',
    };
    if (auth.accountId) headers['ChatGPT-Account-Id'] = auth.accountId;

    const res = await fetch(CODEX_USAGE_URL, { headers });
    if (!res.ok) return { available: false, reason: `http-${res.status}` };
    const data = await res.json();

    // Codex field names vary; normalize common shapes
    const five = data.primary_window || data.five_hour_limit || data.five_hour || null;
    const week = data.secondary_window || data.weekly_limit || data.seven_day || null;

    const parse = (w) => {
      if (!w) return null;
      const used = w.used_percent ?? w.utilization ?? w.used ?? null;
      const resetsAt = w.resets_at ?? w.reset_at ?? w.reset ?? null;
      return used !== null ? { used, resetsAt } : null;
    };

    return {
      available: true,
      platform: 'codex',
      session: five ? { ...parse(five), label: '5-hour' } : null,
      weekly: week ? { ...parse(week), label: 'weekly' } : null,
    };
  } catch (e) {
    return { available: false, reason: `error:${e.message}` };
  }
}

export async function fetchAllLimits() {
  const [claude, codex] = await Promise.all([
    fetchClaudeLimits(),
    fetchCodexLimits()
  ]);
  return { claude, codex };
}

export function formatResetTime(iso) {
  if (!iso) return '—';
  const target = new Date(iso);
  const diffMs = target.getTime() - Date.now();
  if (diffMs <= 0) return 'now';
  const hours = Math.floor(diffMs / 3600000);
  const mins = Math.floor((diffMs % 3600000) / 60000);
  if (hours >= 24) return `${Math.floor(hours / 24)}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}
