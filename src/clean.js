// Text cleanup: Project Gutenberg boilerplate, line-wrapped paragraphs, index pages.

const START_RE = /^\s*\*{3}\s*START OF (?:THE|THIS) PROJECT GUTENBERG[^\n]*$/im;
const END_RE = /^\s*\*{3}\s*END OF (?:THE|THIS) PROJECT GUTENBERG[^\n]*$/im;

export function stripGutenberg(text) {
  let t = String(text ?? '');
  const s = START_RE.exec(t);
  if (s) t = t.slice(s.index + s[0].length);
  const e = END_RE.exec(t);
  if (e) t = t.slice(0, e.index);
  // Older Gutenberg files: "End of the Project Gutenberg EBook of ..." without asterisks.
  const e2 = /^\s*End of (?:the )?Project Gutenberg'?s? (?:EBook|eBook|Etext)[^\n]*$/im.exec(t);
  if (e2) t = t.slice(0, e2.index);
  return t;
}

const isNumberToken = (w) => /^[\divxlc]+[.,;:)]*$/i.test(w) && /\d/.test(w);

function looksLikeIndex(words) {
  if (words.length <= 15) return false;
  const nums = words.filter(isNumberToken).length;
  return nums / words.length >= 0.3;
}

export function toParagraphs(text, { pdf = false } = {}) {
  let t = String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/­/g, '')
    .replace(/\f/g, '\n\n')
    .replace(/\[Illustration\]/gi, ' ');
  if (pdf) t = t.replace(/([A-Za-z])-\n\s*([a-z])/g, '$1$2');
  // _italic_ markers used by Gutenberg plain text
  t = t.replace(/(^|[\s(“"'‘])_([^_\n][^_]*?)_(?=[\s.,;:!?)”"'’]|$)/gm, '$1$2');
  const out = [];
  for (const raw of t.split(/\n[ \t]*\n+/)) {
    const p = raw.replace(/\s+/g, ' ').trim();
    if (!p) continue;
    const words = p.split(' ');
    if (looksLikeIndex(words)) continue;
    out.push(p);
  }
  return out;
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…' };

export function htmlToText(html) {
  return String(html ?? '')
    .replace(/<(script|style|noscript|svg|nav|header|footer)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(br|\/p|\/div|\/h[1-6]|\/li|\/tr|\/blockquote|\/section|\/article)\b[^>]*>/gi, '\n\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n');
}
