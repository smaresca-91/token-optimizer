#!/usr/bin/env node
// @ts-check
// UserPromptSubmit hook: compresses user prompts via Caveman.
// mode='always': always compress (can be aggressive, test your UX tolerance)
// mode='threshold': only compress when context >= activateAt

import { loadConfig, analyzeTranscript, computePressure } from '../src/core.js';
import { cavemanify, compressionRatio } from '../src/caveman.js';

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
  let event; try { event = JSON.parse(raw); } catch { event = {}; }

  const config = loadConfig();
  if (!config.caveman?.enabled) { process.exit(0); return; }

  const prompt = event.prompt || event.user_prompt || '';
  const transcriptPath = event.transcript_path || event.conversation_path;
  if (!prompt) { process.exit(0); return; }

  const mode = config.caveman.mode || 'threshold';
  let shouldCompress = false;

  if (mode === 'always') {
    shouldCompress = true;
  } else if (transcriptPath) {
    const stats = analyzeTranscript(transcriptPath);
    const pressure = computePressure(stats.totalTokens, 200000);
    const activateAt = config.caveman.activateAt ?? config.thresholds.compact;
    shouldCompress = pressure >= activateAt;
  }

  if (!shouldCompress) { process.exit(0); return; }

  const compressed = cavemanify(prompt, config.caveman);
  const ratio = compressionRatio(prompt, compressed);

  // Skip if savings negligible OR compression broke the prompt
  if (ratio < 0.10 || compressed.length < 10) { process.exit(0); return; }

  process.stderr.write(
    `\n\x1b[36m[caveman] Prompt ${(ratio * 100).toFixed(0)}% compressed (${prompt.length}→${compressed.length} chars)\x1b[0m\n`
  );

  const out = {
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: compressed
    }
  };
  process.stdout.write(JSON.stringify(out));
  process.exit(0);
})();
