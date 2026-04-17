// @ts-check
// Summarize old turns using Claude Haiku 4.5 (fast + cheap).
// Requires ANTHROPIC_API_KEY in env.

const API = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-haiku-4-5-20251001';

export async function summarizeTurns(turns, { apiKey = process.env.ANTHROPIC_API_KEY } = {}) {
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY missing');
  if (!turns.length) return '';

  const text = turns.map(t => {
    const role = t.role || t.type || 'msg';
    const content = typeof t.content === 'string' ? t.content : JSON.stringify(t.content);
    return `[${role}] ${content}`;
  }).join('\n\n');

  const prompt = `Summarize this conversation segment in <=300 tokens. Keep: decisions, file paths, code contracts, open tasks, errors. Drop: pleasantries, restatements, verbose explanations. Output plain text, no preamble.\n\n---\n${text}`;

  const res = await fetch(API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 400,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!res.ok) throw new Error(`Haiku API ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return json.content?.[0]?.text || '';
}

export function buildSummaryMessage(summary) {
  return {
    role: 'system',
    content: `[token-optimizer: summary of prior turns]\n${summary}`
  };
}
