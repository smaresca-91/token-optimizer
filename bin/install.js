#!/usr/bin/env node
// @ts-check
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// Normalize paths cross-platform and quote for shell safety.
// On Windows, backslashes must be preserved AND the path quoted.
function shellQuote(p) {
  // Always quote - handles spaces, backslashes, unicode paths on Windows
  return `"${p.replace(/"/g, '\\"')}"`;
}

const HOOKS = {
  Stop: path.join(ROOT, 'bin', 'hook.js'),
  UserPromptSubmit: path.join(ROOT, 'bin', 'hook-user-prompt.js'),
  PreCompact: path.join(ROOT, 'bin', 'hook-precompact.js'),
};

function buildHookEntry(scriptPath) {
  return {
    matcher: '*',
    hooks: [{ type: 'command', command: `node ${shellQuote(scriptPath)}`, timeout: 10 }]
  };
}

function mergeHookConfig(existing, events) {
  existing.hooks ||= {};
  for (const [event, script] of Object.entries(events)) {
    existing.hooks[event] ||= [];
    const already = existing.hooks[event].some(group =>
      (group.hooks || []).some(h => h.command?.includes(path.basename(script)))
    );
    if (!already) existing.hooks[event].push(buildHookEntry(script));
  }
  return existing;
}

function installClaude() {
  const dir = path.join(os.homedir(), '.claude');
  const file = path.join(dir, 'settings.json');
  fs.mkdirSync(dir, { recursive: true });
  const cfg = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf-8')) : {};
  mergeHookConfig(cfg, HOOKS);
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2));
  console.log(`[ok] Claude Code: Stop + UserPromptSubmit + PreCompact -> ${file}`);
}

function installCodex() {
  const dir = path.join(os.homedir(), '.codex');
  const file = path.join(dir, 'hooks.json');
  fs.mkdirSync(dir, { recursive: true });
  const cfg = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf-8')) : {};
  const codexHooks = { Stop: HOOKS.Stop, UserPromptSubmit: HOOKS.UserPromptSubmit };
  mergeHookConfig(cfg, codexHooks);
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2));
  console.log(`[ok] Codex CLI: Stop + UserPromptSubmit -> ${file}`);
  console.log(`     (PreCompact not yet supported by Codex)`);
}

function uninstall(target) {
  const files = [];
  if (target === 'all' || target === 'claude') files.push(path.join(os.homedir(), '.claude', 'settings.json'));
  if (target === 'all' || target === 'codex') files.push(path.join(os.homedir(), '.codex', 'hooks.json'));
  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    const cfg = JSON.parse(fs.readFileSync(file, 'utf-8'));
    if (!cfg.hooks) continue;
    for (const event of Object.keys(cfg.hooks)) {
      cfg.hooks[event] = cfg.hooks[event]
        .map(g => ({ ...g, hooks: (g.hooks || []).filter(h => !h.command?.includes('token-optimizer') && !h.command?.match(/hook(-[a-z]+)?\.js/)) }))
        .filter(g => g.hooks.length > 0);
      if (cfg.hooks[event].length === 0) delete cfg.hooks[event];
    }
    fs.writeFileSync(file, JSON.stringify(cfg, null, 2));
    console.log(`[ok] Uninstalled from ${file}`);
  }
}

const action = process.argv[2] || 'install';
const target = process.argv[3] || 'all';

if (action === 'uninstall') {
  uninstall(target);
} else {
  if (target === 'all' || target === 'claude') installClaude();
  if (target === 'all' || target === 'codex') installCodex();
  console.log('\nRestart your CLI session to activate.');
}