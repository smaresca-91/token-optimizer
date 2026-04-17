#!/usr/bin/env node
// @ts-check
// PreCompact hook: archives full transcript before compaction.
// Enables "undo" and post-mortem analysis.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { analyzeTranscript } from '../src/core.js';

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

  const transcriptPath = event.transcript_path || event.conversation_path;
  if (!transcriptPath || !fs.existsSync(transcriptPath)) { process.exit(0); return; }

  const backupDir = path.join(os.homedir(), '.token-optimizer', 'backups');
  fs.mkdirSync(backupDir, { recursive: true });

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const sessionId = event.session_id || 'session';
  const dest = path.join(backupDir, `${sessionId}-${ts}.jsonl`);

  fs.copyFileSync(transcriptPath, dest);

  const stats = analyzeTranscript(transcriptPath);
  const meta = {
    timestamp: Date.now(),
    sessionId,
    sourcePath: transcriptPath,
    backupPath: dest,
    ...stats
  };
  fs.writeFileSync(dest + '.meta.json', JSON.stringify(meta, null, 2));

  // Rotate: keep only last 20 backups
  const backups = fs.readdirSync(backupDir)
    .filter(f => f.endsWith('.jsonl'))
    .map(f => ({ name: f, mtime: fs.statSync(path.join(backupDir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);

  for (const old of backups.slice(20)) {
    fs.unlinkSync(path.join(backupDir, old.name));
    const metaFile = path.join(backupDir, old.name + '.meta.json');
    if (fs.existsSync(metaFile)) fs.unlinkSync(metaFile);
  }

  process.stderr.write(
    `\n\x1b[90m[token-optimizer] Pre-compact backup: ${path.basename(dest)} (${stats.totalTokens.toLocaleString()} tok)\x1b[0m\n`
  );
  process.exit(0);
})();
