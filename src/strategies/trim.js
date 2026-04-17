// @ts-check
// Strategy: keep first K (system/context) + last N (recent) turns.

export function trimTranscript(messages, { keepFirst = 2, keepRecent = 20 } = {}) {
  if (messages.length <= keepFirst + keepRecent) return { kept: messages, dropped: [] };
  const head = messages.slice(0, keepFirst);
  const tail = messages.slice(-keepRecent);
  const dropped = messages.slice(keepFirst, messages.length - keepRecent);
  return { kept: [...head, ...tail], dropped };
}

export function buildSummaryMarker(droppedCount, droppedTokens) {
  return {
    role: 'system',
    content: `[token-optimizer] Trimmed ${droppedCount} mid-conversation turns (~${droppedTokens} tokens). Earlier context preserved in summary.`
  };
}
