// @ts-check
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { countTokens, heuristic } from './tokenizer.js';

const CONFIG_PATH = path.join(os.homedir(), '.token-optimizer', 'config.json');
const LOG_PATH = path.join(os.homedir(), '.token-optimizer', 'usage.jsonl');

export function loadConfig() {
  const defaultPath = new URL('../config/default.json', import.meta.url);
  const defaults = JSON.parse(fs.readFileSync(defaultPath, 'utf-8'));
  if (fs.existsSync(CONFIG_PATH)) {
    const user = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    return { ...defaults, ...user };
  }
  return defaults;
}

// Backward-compat export
export function estimateTokens(text) { return heuristic(text); }

export function analyzeTranscript(transcriptPath, platform = 'claude-code') {
  if (!fs.existsSync(transcriptPath)) {
    return { turns: 0, totalTokens: 0, breakdown: { user: 0, assistant: 0, tools: 0 } };
  }
  const raw = fs.readFileSync(transcriptPath, 'utf-8');
  const lines = raw.split('\n').filter(Boolean);

  let userTokens = 0;
  let assistantTokens = 0;
  let toolTokens = 0;
  let turns = 0;

  for (const line of lines) {
    try {
      const msg = JSON.parse(line);
      const content = typeof msg.content === 'string'
        ? msg.content
        : JSON.stringify(msg.content || '');
      const tokens = countTokens(content, platform);
      if (msg.role === 'user') { userTokens += tokens; turns++; }
      else if (msg.role === 'assistant') assistantTokens += tokens;
      else if (msg.type === 'tool_use' || msg.type === 'tool_result') toolTokens += tokens;
    } catch { /* skip malformed */ }
  }

  const total = userTokens + assistantTokens + toolTokens;
  return {
    turns,
    totalTokens: total,
    breakdown: { user: userTokens, assistant: assistantTokens, tools: toolTokens }
  };
}

export function computePressure(totalTokens, window) {
  return totalTokens / window;
}

export function appendLog(entry) {
  const dir = path.dirname(LOG_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(LOG_PATH, JSON.stringify({ ts: Date.now(), ...entry }) + '\n');
}
