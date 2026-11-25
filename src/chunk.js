// Paragraph-aware chunking with sentence-aligned overlap.
import { splitSentences } from './verify.js';

export const countWords = (s) => {
  const t = String(s ?? '').trim();
  return t ? t.split(/\s+/).length : 0;
};

export const chunkId = (docSeq, ord) => `D${String(docSeq).padStart(2, '0')}-C${String(ord).padStart(4, '0')}`;

function splitLong(text, max) {
  // Split an oversized paragraph at sentence ends; hard-split sentences that are still too long.
  const pieces = [];
  let cur = [];
  let wc = 0;
  for (const s of splitSentences(text)) {
    const sw = countWords(s);
    if (sw > max) {
      if (cur.length) { pieces.push(cur.join(' ')); cur = []; wc = 0; }
      const words = s.split(/\s+/);
      for (let i = 0; i < words.length; i += max) pieces.push(words.slice(i, i + max).join(' '));
      continue;
    }
    if (wc + sw > max && cur.length) { pieces.push(cur.join(' ')); cur = []; wc = 0; }
    cur.push(s); wc += sw;
  }
  if (cur.length) pieces.push(cur.join(' '));
  return pieces;
}

function tailSentences(text, overlap) {
  const sents = splitSentences(text);
  const out = [];
  let wc = 0;
  for (let i = sents.length - 1; i >= 0; i--) {
    const w = countWords(sents[i]);
    if (wc + w > overlap) break;
    out.unshift(sents[i]);
    wc += w;
  }
  return out.join(' ');
}

/**
 * @param {string[]} paragraphs
 * @returns {{text:string, words:number}[]}
 */
export function chunkParagraphs(paragraphs, { target = 260, max = 380, overlap = 45 } = {}) {
  const units = [];
  for (const p of paragraphs || []) {
    const t = String(p ?? '').trim();
    if (!t) continue;
    if (countWords(t) > max) units.push(...splitLong(t, max));
    else units.push(t);
  }
  const chunks = [];
  let carry = '';
  let cur = [];
  let wc = 0;
  const flush = () => {
    if (!cur.length) return;
    const body = cur.join('\n\n');
    const text = carry ? `${carry}\n\n${body}` : body;
    chunks.push({ text, words: countWords(text) });
    carry = overlap > 0 ? tailSentences(cur[cur.length - 1], overlap) : '';
    cur = [];
    wc = 0;
  };
  for (const u of units) {
    const uw = countWords(u);
    if (cur.length && wc + uw > max) flush();
    cur.push(u);
    wc += uw;
    if (wc >= target) flush();
  }
  flush();
  return chunks;
}
