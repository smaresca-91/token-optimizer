#!/usr/bin/env node
// @ts-check
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadConfig, analyzeTranscript, computePressure } from '../src/core.js';
import { cavemanify, compressionRatio } from '../src/caveman.js';
import { sessionCost } from '../src/cost.js';
import { tokenizerInfo } from '../src/tokenizer.js';
import { fetchAllLimits } from '../src/usage-limits.js';
import { renderPlanLimits } from '../src/reporter.js';

const LOG = path.join(os.homedir(), '.token-optimizer', 'usage.jsonl');
const BACKUP_DIR = path.join(os.homedir(), '.token-optimizer', 'backups');

const cmd = process.argv[2];
const arg = process.argv[3];

function stats() {
  if (!fs.existsSync(LOG)) return console.log('No usage log yet.');
  const lines = fs.readFileSync(LOG, 'utf-8').split('\n').filter(Boolean).map(JSON.parse);
  const total = lines.reduce((a, l) => a + (l.stats?.totalTokens || 0), 0);
  const turns = lines.reduce((a, l) => a + (l.stats?.turns || 0), 0);
  const avgPressure = (lines.reduce((a, l) => a + (l.pressure || 0), 0) / lines.length * 100).toFixed(1);

  const byPlatform = lines.reduce((acc, l) => {
    const p = l.platform || 'unknown';
    acc[p] ||= { sessions: 0, tokens: 0 };
    acc[p].sessions++;
    acc[p].tokens += l.stats?.totalTokens || 0;
    return acc;
  }, {});

  console.log(`\nToken Optimizer Stats`);
  console.log(`─────────────────────────`);
  console.log(`Sessions: ${lines.length}   Tokens: ${total.toLocaleString()}   Turns: ${turns}   Avg pressure: ${avgPressure}%`);
  console.log(`\nBy platform:`);
  for (const [p, d] of Object.entries(byPlatform)) {
    console.log(`  ${p.padEnd(20)} ${d.sessions} sessions, ${d.tokens.toLocaleString()} tok`);
  }
  const last = lines.slice(-5);
  console.log(`\nLast ${last.length} sessions:`);
  for (const l of last) {
    const date = new Date(l.ts).toISOString().slice(0, 19);
    const pct = (l.pressure * 100).toFixed(1);
    console.log(`  ${date}  ${pct.padStart(5)}%  ${(l.stats?.totalTokens || 0).toLocaleString().padStart(8)} tok`);
  }
}

function showConfig() {
  console.log('Tokenizers:', JSON.stringify(tokenizerInfo(), null, 2));
  console.log('\nConfig:');
  console.log(JSON.stringify(loadConfig(), null, 2));
}
function reset() { if (fs.existsSync(LOG)) fs.unlinkSync(LOG); console.log('Log cleared.'); }

function analyzeFile(filepath) {
  if (!filepath) return console.log('Usage: tko analyze <transcript.jsonl>');
  const stats = analyzeTranscript(filepath);
  const pressure = computePressure(stats.totalTokens, 200000);
  const cost = sessionCost(stats, 'claude-sonnet-4-6');
  console.log(`\nFile: ${filepath}`);
  console.log(`Tokens:   ${stats.totalTokens.toLocaleString()}`);
  console.log(`Turns:    ${stats.turns}`);
  console.log(`Pressure: ${(pressure * 100).toFixed(1)}%`);
  console.log(`Cost:     ${cost.formatted}`);
  console.log(`Breakdown: user=${stats.breakdown.user} asst=${stats.breakdown.assistant} tools=${stats.breakdown.tools}`);
}

function testCaveman(text) {
  if (!text) return console.log('Usage: tko test-caveman "your text here"');
  const config = loadConfig();
  const out = cavemanify(text, config.caveman);
  const ratio = compressionRatio(text, out);
  console.log(`\nOriginal  (${text.length} chars): ${text}`);
  console.log(`Compressed (${out.length} chars): ${out}`);
  console.log(`Savings: ${(ratio * 100).toFixed(1)}%`);
}

function listBackups() {
  if (!fs.existsSync(BACKUP_DIR)) return console.log('No backups.');
  const files = fs.readdirSync(BACKUP_DIR).filter(f => f.endsWith('.jsonl')).sort().reverse();
  if (!files.length) return console.log('No backups.');
  console.log(`\nPre-compact backups (${BACKUP_DIR})`);
  console.log(`─────────────────────────`);
  for (const f of files) {
    const meta = path.join(BACKUP_DIR, f + '.meta.json');
    let info = '';
    if (fs.existsSync(meta)) {
      const m = JSON.parse(fs.readFileSync(meta, 'utf-8'));
      info = ` [${m.totalTokens?.toLocaleString()} tok, ${m.turns} turns]`;
    }
    console.log(`  ${f}${info}`);
  }
}

function toggleCaveman(state) {
  const userConfig = path.join(os.homedir(), '.token-optimizer', 'config.json');
  fs.mkdirSync(path.dirname(userConfig), { recursive: true });
  let cfg = {};
  if (fs.existsSync(userConfig)) {
    try { cfg = JSON.parse(fs.readFileSync(userConfig, 'utf-8')); } catch {}
  }
  cfg.caveman ||= {};

  if (state === 'on')      { cfg.caveman.enabled = true;  cfg.caveman.mode = 'always'; }
  else if (state === 'off'){ cfg.caveman.enabled = false; }
  else if (state === 'threshold') { cfg.caveman.enabled = true; cfg.caveman.mode = 'threshold'; }
  else { console.log('Usage: tko caveman [on|off|threshold]'); return; }

  fs.writeFileSync(userConfig, JSON.stringify(cfg, null, 2));
  console.log(`Caveman: enabled=${cfg.caveman.enabled}, mode=${cfg.caveman.mode || 'threshold'}`);
  console.log(`Config saved: ${userConfig}`);
}

async function showLimits() {
  const { claude, codex } = await fetchAllLimits();
  console.log('');
  console.log(renderPlanLimits(claude));
  console.log('');
  console.log(renderPlanLimits(codex));
  console.log('');
}

function help() {
  console.log(`
token-optimizer (tko)

  install [claude|codex|all]     Register hooks
  uninstall [claude|codex|all]   Remove hooks
  stats                          Aggregate usage across sessions
  limits                         Show plan limits (5h + weekly) for both CLIs
  caveman [on|off|threshold]     Toggle always-on compression mode
  config                         Print active config
  analyze <file.jsonl>           Inspect a transcript file
  test-caveman "<text>"          Preview caveman compression
  backups                        List pre-compact backups
  reset                          Clear usage log
`);
}

switch (cmd) {
  case 'install':
  case 'uninstall':
    await import('./install.js');
    break;
  case 'stats': stats(); break;
  case 'limits': await showLimits(); break;
  case 'caveman': toggleCaveman(arg); break;
  case 'config': showConfig(); break;
  case 'reset': reset(); break;
  case 'analyze': analyzeFile(arg); break;
  case 'test-caveman': testCaveman(arg); break;
  case 'backups': listBackups(); break;
  default: help();
}
