// Deterministic grounding checks: quotes must appear in the cited chunk, citations must point at
// chunks that were actually retrieved.

export function normalizeForMatch(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[‘’ʼ`´]/g, "'")
    .replace(/[“”«»„]/g, '"')
    .replace(/[–—―]/g, '-')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function checkQuote(quote, chunkText) {
  const q = normalizeForMatch(quote);
  if (!q) return 'missing';
  const c = normalizeForMatch(chunkText);
  if (c.includes(q)) return 'exact';
  const qWords = q.split(' ').filter((w) => w.length >= 3);
  if (!qWords.length) return 'missing';
  const cWords = new Set(c.split(' '));
  const hit = qWords.filter((w) => cWords.has(w)).length;
  return hit / qWords.length >= 0.8 ? 'close' : 'missing';
}

const RANK = { exact: 2, close: 1, missing: 0 };

/**
 * @param {{fact:string, chunkIds:string[], quote:string}[]} facts
 * @param {Record<string,{text:string}>} retrievedChunks  chunk id -> chunk
 */
export function screenFacts(facts, retrievedChunks) {
  const kept = [];
  const rejected = [];
  for (const f of facts || []) {
    const ids = [...new Set((f.chunkIds || []).filter((id) => retrievedChunks[id]))];
    if (!ids.length) { rejected.push({ ...f, chunkIds: f.chunkIds || [], reason: 'unknown-citation' }); continue; }
    let best = 'missing';
    for (const id of ids) {
      const r = checkQuote(f.quote, retrievedChunks[id].text);
      if (RANK[r] > RANK[best]) best = r;
    }
    if (best === 'missing') { rejected.push({ ...f, chunkIds: ids, reason: 'quote-not-found' }); continue; }
    kept.push({ ...f, chunkIds: ids, quoteCheck: best });
  }
  return { kept, rejected };
}

export function deterministicFlags(sentence, allowedIds) {
  const ids = sentence?.chunkIds || [];
  const flags = [];
  if (!ids.length) flags.push('no-citation');
  else if (ids.some((id) => !allowedIds.has(id))) flags.push('unknown-citation');
  return flags;
}

/**
 * Names and numbers in a sentence that appear in none of its cited chunks: a cheap, deterministic
 * tell for detail that came from the model's own memory. Checks capitalized words that aren't the
 * first word of the sentence, plus every number. `ignore` = words to skip (the person's name).
 */
export function unmatchedTerms(sentenceText, chunkTexts, ignore = []) {
  const hay = normalizeForMatch(chunkTexts.join(' '));
  const skip = new Set(ignore.map((w) => w.toLowerCase()));
  const words = String(sentenceText ?? '').replace(/[“”"()[\]]/g, ' ').split(/\s+/).filter(Boolean);
  const out = new Set();
  words.forEach((raw, i) => {
    const w = raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').replace(/['’]s$/i, '');
    if (!w) return;
    const isNum = /^\d[\d,.]*$/.test(w);
    const prev = words[i - 1] || '';
    const sentenceStart = i === 0 || /[.!?:]$/.test(prev);
    const isName = /^\p{Lu}/u.test(w) && !sentenceStart;
    if (!isNum && !isName) return;
    if (skip.has(w.toLowerCase())) return;
    const n = normalizeForMatch(isNum ? w.replace(/,/g, '') : w);
    const hayNum = isNum ? hay.replace(/(\d) (?=\d{3}\b)/g, '$1') : hay;
    // Numbers may appear as ordinals in the source ("17" vs "17th").
    const tail = isNum ? '(st|nd|rd|th)?' : '';
    if (!new RegExp(`(^| )${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}${tail}( |$)`).test(hayNum)) out.add(w);
  });
  return [...out];
}

const ABBREV =/(?:\b(?:Mr|Mrs|Ms|Dr|St|Sr|Jr|Prof|Gen|Col|Capt|Lt|Rev|Hon|Gov|Mt|vs|etc|viz|cf|vol|ch|pp|p|No|Esq)|\b[A-Z])\.$/;

export function splitSentences(text) {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return [];
  const parts = t.split(/(?<=[.!?][”"’')\]]*)\s+(?=[“"‘'(\[]?[A-Z0-9])/);
  const out = [];
  for (const p of parts) {
    if (out.length && ABBREV.test(out[out.length - 1])) out[out.length - 1] += ' ' + p;
    else out.push(p);
  }
  return out.map((s) => s.trim()).filter(Boolean);
}
