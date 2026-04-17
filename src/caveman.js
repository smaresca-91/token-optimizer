// @ts-check
// Caveman mode: strip fillers, shorten sentences, keep signal.

const FILLERS_EN = new Set([
  'the','a','an','is','are','am','was','were','be','been','being',
  'that','this','these','those','there','here',
  'actually','basically','literally','essentially','simply','really','very','just',
  'please','kindly','sort','kind','like','you','know',
  'in','on','at','of','for','to','with','from','by','as','so','then'
]);

const FILLERS_IT = new Set([
  'il','lo','la','i','gli','le','un','uno','una',
  'è','sono','era','erano','essere','stato',
  'che','questo','questa','quello','quella',
  'praticamente','letteralmente','sostanzialmente','veramente','molto','proprio',
  'per favore','gentilmente','tipo','sai',
  'in','su','a','di','per','con','da','come'
]);

export function detectLang(text) {
  const it = /\b(il|la|che|sono|non|della|perché|grazie)\b/gi;
  const en = /\b(the|and|that|with|this|have|from|they)\b/gi;
  const itCount = (text.match(it) || []).length;
  const enCount = (text.match(en) || []).length;
  return itCount > enCount ? 'it' : 'en';
}

export function stripFillers(text, lang) {
  const set = lang === 'it' ? FILLERS_IT : FILLERS_EN;
  return text.split(/\s+/).filter(w => {
    const clean = w.toLowerCase().replace(/[^\p{L}]/gu, '');
    return clean && !set.has(clean);
  }).join(' ');
}

export function shortenSentences(text, maxWords = 12) {
  const sentences = text.split(/(?<=[.!?])\s+/);
  return sentences.map(s => {
    const words = s.split(/\s+/);
    if (words.length <= maxWords) return s;
    // Keep first maxWords, drop rest
    return words.slice(0, maxWords).join(' ') + (s.match(/[.!?]$/) ? s.slice(-1) : '.');
  }).join(' ');
}

export function cavemanify(text, config = {}) {
  const { stripFillers: strip = true, maxSentenceWords = 12, preserveCodeBlocks = true } = config;
  const lang = detectLang(text);

  // Extract and preserve code blocks before processing
  const codeBlocks = [];
  let working = text;
  if (preserveCodeBlocks) {
    // Fenced code blocks ```...```
    working = working.replace(/```[\s\S]*?```/g, (match) => {
      codeBlocks.push(match);
      return `\x00CODE${codeBlocks.length - 1}\x00`;
    });
    // Inline code `...`
    working = working.replace(/`[^`\n]+`/g, (match) => {
      codeBlocks.push(match);
      return `\x00CODE${codeBlocks.length - 1}\x00`;
    });
  }

  let out = working;
  if (strip) out = stripFillers(out, lang);
  if (maxSentenceWords > 0) out = shortenSentences(out, maxSentenceWords);
  out = out.replace(/\s+/g, ' ').trim();

  // Restore code blocks
  out = out.replace(/\x00CODE(\d+)\x00/g, (_, i) => codeBlocks[Number(i)] || '');
  return out;
}

export function compressionRatio(original, compressed) {
  if (!original.length) return 0;
  return 1 - (compressed.length / original.length);
}
