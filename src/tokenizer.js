// @ts-check
// Precise token counting with real tokenizers.
// Falls back to 4-char heuristic only if packages missing.

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

let gptEncode = null;       // null = not tried, false = unavailable, function = loaded
let anthropicCount = null;

function loadGpt() {
  if (gptEncode !== null) return gptEncode;
  try {
    const mod = require('gpt-tokenizer');
    gptEncode = mod.encode || mod.default?.encode;
    if (typeof gptEncode !== 'function') gptEncode = false;
  } catch { gptEncode = false; }
  return gptEncode;
}

function loadAnthropic() {
  if (anthropicCount !== null) return anthropicCount;
  try {
    const mod = require('@anthropic-ai/tokenizer');
    anthropicCount = mod.countTokens || mod.default?.countTokens;
    if (typeof anthropicCount !== 'function') anthropicCount = false;
  } catch { anthropicCount = false; }
  return anthropicCount;
}

export function heuristic(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Count tokens using best available tokenizer.
 * @param {string} text
 * @param {'claude-code'|'codex'} platform
 */
export function countTokens(text, platform = 'claude-code') {
  if (!text) return 0;
  if (platform === 'codex') {
    const enc = loadGpt();
    if (enc) return enc(text).length;
  } else {
    const count = loadAnthropic();
    if (count) return count(text);
  }
  return heuristic(text);
}

export function tokenizerInfo() {
  return {
    anthropic: loadAnthropic() ? 'loaded' : 'missing (using heuristic)',
    gpt: loadGpt() ? 'loaded' : 'missing (using heuristic)'
  };
}
