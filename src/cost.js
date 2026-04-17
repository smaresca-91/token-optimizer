// @ts-check
// Rough cost estimation. Update rates as needed.
// Numbers per million tokens (USD).

export const PRICING = {
  'claude-opus-4-7':    { input: 15.00, output: 75.00 },
  'claude-sonnet-4-6':  {  input: 3.00, output: 15.00 },
  'claude-haiku-4-5':   {  input: 0.80, output:  4.00 },
  'gpt-5-codex':        {  input: 2.50, output: 10.00 },
  'gpt-5-3':            {  input: 1.25, output:  5.00 },
};

export function estimateCost({ inputTokens, outputTokens, model = 'claude-sonnet-4-6' }) {
  const rate = PRICING[model] || PRICING['claude-sonnet-4-6'];
  const inCost = (inputTokens / 1_000_000) * rate.input;
  const outCost = (outputTokens / 1_000_000) * rate.output;
  return {
    input: inCost,
    output: outCost,
    total: inCost + outCost,
    formatted: `$${(inCost + outCost).toFixed(4)}`
  };
}

export function sessionCost(stats, model) {
  // Heuristic: user+tools = input, assistant = output
  const input = (stats.breakdown?.user || 0) + (stats.breakdown?.tools || 0);
  const output = stats.breakdown?.assistant || 0;
  return estimateCost({ inputTokens: input, outputTokens: output, model });
}
