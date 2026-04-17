#!/usr/bin/env node
// @ts-check
// Unified hook for Claude Code (Stop / PostToolUse) and Codex (Stop / PostToolUse)
// Reads JSON from stdin, writes report to stderr (visible to user),
// returns JSON on stdout with additionalContext for model consumption.

import { loadConfig, analyzeTranscript, computePressure, appendLog } from '../src/core.js';
import { renderReport, buildSuggestion, renderPlanLimits } from '../src/reporter.js';
import { sessionCost } from '../src/cost.js';
import { fetchClaudeLimits, fetchCodexLimits } from '../src/usage-limits.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const CACHE_FILE = path.join(os.homedir(), '.token-optimizer', 'limits-cache.json');

async function getCachedLimits(platform, ttlSeconds) {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
      const entry = cache[platform];
      if (entry && (Date.now() - entry.ts) / 1000 < ttlSeconds) {
        return entry.data;
      }
    }
  } catch { /* ignore */ }
  const data = platform === 'codex' ? await fetchCodexLimits() : await fetchClaudeLimits();
  try {
    const cache = fs.existsSync(CACHE_FILE) ? JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8')) : {};
    cache[platform] = { ts: Date.now(), data };
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache));
  } catch { /* ignore */ }
  return data;
}

async function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    if (process.stdin.isTTY) return resolve('{}');
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (c) => (data += c));
    process.stdin.on('end', () => resolve(data || '{}'));
  });
}

(async () => {
  const raw = await readStdin();
  let event;
  try { event = JSON.parse(raw); } catch { event = {}; }

  const config = loadConfig();
  // Detect platform: Claude Code sends transcript_path, Codex sends conversation_path
  const transcriptPath =
    event.transcript_path ||
    event.conversation_path ||
    event.transcriptPath ||
    null;

  const platform = event.hook_event_name || event.hookEventName || 'unknown';
  const windowKey = transcriptPath?.includes('codex') ? 'codex' : 'claude-code';
  const window = config.contextWindow[windowKey] || 200000;

  const stats = transcriptPath
    ? analyzeTranscript(transcriptPath, windowKey)
    : { turns: 0, totalTokens: 0, breakdown: { user: 0, assistant: 0, tools: 0 } };

  const pressure = computePressure(stats.totalTokens, window);
  const suggestion = buildSuggestion(pressure, config);
  const model = windowKey === 'codex' ? 'gpt-5-codex' : 'claude-sonnet-4-6';
  const cost = config.reporting.showCost ? sessionCost(stats, model) : null;
  const report = renderReport({ stats, pressure, config, suggestion, cost });

  // stderr => shown to user, does not pollute model context
  process.stderr.write(report);

  // Plan limits (5-hour + weekly) - cached to avoid hammering the API
  if (config.reporting.showPlanLimits) {
    const ttl = config.reporting.planLimitsCacheSeconds || 60;
    const limits = await getCachedLimits(windowKey, ttl);
    if (limits) {
      process.stderr.write(renderPlanLimits(limits) + '\n\n');

      // If ANY plan limit is near exhaustion, inject warning to model too
      const critical = [limits.session, limits.weekly, limits.weeklyOpus]
        .filter(Boolean)
        .some(w => (w.used ?? 0) >= 90);
      if (critical && pressure < config.thresholds.critical) {
        const out = {
          hookSpecificOutput: {
            hookEventName: 'Stop',
            additionalContext: `[token-optimizer] Plan limit >=90%. Apply Caveman mode: terse responses, minimal tool calls.`
          }
        };
        process.stdout.write(JSON.stringify(out));
      }
    }
  }

  if (config.reporting.persistLog) {
    appendLog({ platform, event: event.hook_event_name, stats, pressure });
  }

  // Build instruction set based on Caveman mode
  const cavemanMode = config.caveman?.mode || 'threshold';
  const cavemanAlwaysOn = cavemanMode === 'always' && config.caveman?.enabled;
  const maxWords = config.caveman?.maxSentenceWords || 12;

  let modelInstructions = [];

  // Always-on Caveman: inject every turn
  if (cavemanAlwaysOn) {
    modelInstructions.push(
      `[token-optimizer caveman-always] Respond in terse style: sentences max ${maxWords} words, strip filler words (the/a/is/are/basically/actually), direct answers only. Preserve code blocks verbatim. If user asks for detailed explanation, ignore this rule for that turn.`
    );
  }

  // Inject context back to model at critical pressure
  if (pressure >= config.thresholds.critical) {
    modelInstructions.push(
      `[token-optimizer] Context ${(pressure * 100).toFixed(0)}% full. Suggest /compact immediately.`
    );
  }

  if (modelInstructions.length > 0) {
    const out = {
      hookSpecificOutput: {
        hookEventName: 'Stop',
        additionalContext: modelInstructions.join('\n')
      },
      suppressOutput: false
    };
    process.stdout.write(JSON.stringify(out));
  }
  process.exit(0);
})();
