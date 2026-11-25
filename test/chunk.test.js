import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { chunkParagraphs, countWords, chunkId } from '../src/chunk.js';

const NAMES = ['Ada', 'Walter', 'Mabel', 'Oswin', 'Clara', 'Edmund', 'Lucy', 'Arthur'];
const PLACES = ['river', 'harbor', 'meadow', 'canal', 'market', 'hillside', 'quarry'];

// Exactly 13 words each; unique per index.
function sentence(i) {
  return `Sentence ${i} tells how the traveler ${NAMES[i % NAMES.length]} crossed the ${PLACES[i % PLACES.length]} near ${i} bridges.`;
}

function makeSentences(count, start = 0) {
  return Array.from({ length: count }, (_, k) => sentence(start + k));
}

// paragraphs of `perPara` sentences each
function makeParagraphs(totalSentences, perPara) {
  const paras = [];
  for (let i = 0; i < totalSentences; i += perPara) {
    paras.push(makeSentences(Math.min(perPara, totalSentences - i), i).join(' '));
  }
  return paras;
}

const ws = (s) => s.replace(/\s+/g, ' ').trim();

describe('countWords', () => {
  test('counts whitespace-separated words', () => {
    assert.equal(countWords('one two three'), 3);
  });

  test('ignores repeated spaces and newlines', () => {
    assert.equal(countWords('one  two\n\nthree\tfour'), 4);
  });

  test('empty string has zero words', () => {
    assert.equal(countWords(''), 0);
  });

  test('test sentence helper really has 13 words', () => {
    assert.equal(countWords(sentence(7)), 13);
  });
});

describe('chunkId', () => {
  test('formats doc and chunk numbers with zero padding', () => {
    assert.equal(chunkId(2, 147), 'D02-C0147');
    assert.equal(chunkId(12, 3), 'D12-C0003');
  });

  test('pads small numbers', () => {
    assert.equal(chunkId(1, 0), 'D01-C0000');
  });
});

describe('chunkParagraphs', () => {
  test('empty input returns []', () => {
    assert.deepEqual(chunkParagraphs([]), []);
  });

  test('a short document gives exactly one chunk containing all text', () => {
    const paras = ['A short paragraph about one thing.', 'And another short paragraph about a second thing.'];
    const chunks = chunkParagraphs(paras);
    assert.equal(chunks.length, 1);
    assert.ok(ws(chunks[0].text).includes('A short paragraph about one thing.'));
    assert.ok(ws(chunks[0].text).includes('And another short paragraph about a second thing.'));
    assert.equal(typeof chunks[0].words, 'number');
    assert.ok(chunks[0].words > 0);
  });

  test('a long document gives many chunks, each at most max+overlap words (defaults)', () => {
    const paras = makeParagraphs(400, 10); // ~5200 words
    const chunks = chunkParagraphs(paras);
    assert.ok(chunks.length > 5, `expected many chunks, got ${chunks.length}`);
    for (const c of chunks) {
      const n = countWords(c.text);
      assert.ok(n <= 380 + 45, `chunk has ${n} words, limit is ${380 + 45}`);
      assert.ok(c.words <= 380 + 45, `reported words ${c.words} exceeds limit`);
      assert.ok(n > 0);
    }
  });

  test('respects custom max and overlap options', () => {
    const paras = makeParagraphs(120, 10);
    const opts = { target: 50, max: 80, overlap: 15 };
    const chunks = chunkParagraphs(paras, opts);
    assert.ok(chunks.length > 10);
    for (const c of chunks) {
      const n = countWords(c.text);
      assert.ok(n <= opts.max + opts.overlap, `chunk has ${n} words, limit is ${opts.max + opts.overlap}`);
    }
  });

  test('overlap: each later chunk starts with whole-sentence text found at the end of the previous chunk', () => {
    const chunks = chunkParagraphs(makeParagraphs(300, 10));
    assert.ok(chunks.length > 2);
    for (let i = 1; i < chunks.length; i++) {
      const prev = ws(chunks[i - 1].text);
      const cur = ws(chunks[i].text);
      const firstWords = cur.split(' ').slice(0, 5).join(' ');
      assert.ok(prev.includes(firstWords), `chunk ${i} start "${firstWords}" not found in previous chunk`);

      const firstSentence = cur.slice(0, cur.indexOf('.') + 1);
      assert.ok(firstSentence.length > 10);
      assert.ok(prev.includes(firstSentence), `chunk ${i} first sentence not found in previous chunk`);

      // and it should be near the end of the previous chunk (within the last max-ish tail, not the middle)
      const idx = prev.lastIndexOf(firstSentence);
      const wordsAfter = countWords(prev.slice(idx));
      assert.ok(wordsAfter <= 45 + 13, `overlap region is ${wordsAfter} words`);
    }
  });

  test('coverage: every sentence of the input appears in at least one chunk', () => {
    const sentences = makeSentences(300);
    const paras = [];
    for (let i = 0; i < sentences.length; i += 10) paras.push(sentences.slice(i, i + 10).join(' '));
    const chunks = chunkParagraphs(paras);
    const texts = chunks.map((c) => ws(c.text));
    for (const s of sentences) {
      assert.ok(texts.some((t) => t.includes(s)), `sentence missing from all chunks: ${s}`);
    }
  });

  test('coverage also holds with small custom limits', () => {
    const sentences = makeSentences(90);
    const paras = [];
    for (let i = 0; i < sentences.length; i += 6) paras.push(sentences.slice(i, i + 6).join(' '));
    const chunks = chunkParagraphs(paras, { target: 40, max: 60, overlap: 15 });
    const texts = chunks.map((c) => ws(c.text));
    for (const s of sentences) {
      assert.ok(texts.some((t) => t.includes(s)), `sentence missing: ${s}`);
    }
  });

  test('a giant single paragraph gets split into several chunks within the limit', () => {
    const giant = makeSentences(200).join(' '); // 2600 words in one paragraph
    assert.equal(countWords(giant), 2600);
    const chunks = chunkParagraphs([giant]);
    assert.ok(chunks.length > 1, 'giant paragraph was not split');
    for (const c of chunks) {
      assert.ok(countWords(c.text) <= 380 + 45);
    }
    const texts = chunks.map((c) => ws(c.text));
    for (const s of makeSentences(200)) {
      assert.ok(texts.some((t) => t.includes(s)), `sentence lost when splitting giant paragraph: ${s}`);
    }
  });

  test('the first chunk starts with the first paragraph text', () => {
    const paras = makeParagraphs(100, 10);
    const chunks = chunkParagraphs(paras);
    assert.ok(ws(chunks[0].text).startsWith(sentence(0)));
  });
});
