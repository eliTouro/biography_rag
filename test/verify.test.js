import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeForMatch,
  checkQuote,
  screenFacts,
  deterministicFlags,
  splitSentences,
} from '../src/verify.js';

const CHUNK_A_TEXT =
  'Ada was born in Exampleton, a small river town, in 1801. Her father kept a shop that sold rope and lamp oil.';
const CHUNK_B_TEXT =
  'In 1824 Ada sailed on the Marigold to Larkhaven, and a dangerous storm struck on the twelfth night.';

const chunks = {
  'D01-C0000': { id: 'D01-C0000', docId: 'D01', filename: 'a.txt', page: null, text: CHUNK_A_TEXT },
  'D01-C0001': { id: 'D01-C0001', docId: 'D01', filename: 'a.txt', page: null, text: CHUNK_B_TEXT },
};

describe('normalizeForMatch', () => {
  test('lowercases, strips punctuation and collapses whitespace', () => {
    assert.equal(normalizeForMatch('  Hello,   WORLD!  '), 'hello world');
  });

  test('turns newlines and tabs into single spaces', () => {
    assert.equal(normalizeForMatch('Hello\n\tWorld'), 'hello world');
  });

  test('curly quotes normalize the same as plain quotes', () => {
    assert.equal(normalizeForMatch('“Quoted” text'), normalizeForMatch('"Quoted" text'));
    assert.equal(normalizeForMatch('it’s here'), normalizeForMatch("it's here"));
  });

  test('en and em dashes normalize the same as a plain dash', () => {
    assert.equal(normalizeForMatch('a — b'), normalizeForMatch('a - b'));
    assert.equal(normalizeForMatch('a – b'), normalizeForMatch('a - b'));
  });

  test('is idempotent', () => {
    const once = normalizeForMatch('Ada’s  “Voyage”, 1824!');
    assert.equal(normalizeForMatch(once), once);
  });
});

describe('checkQuote', () => {
  test('exact: substring match', () => {
    assert.equal(checkQuote('born in Exampleton, a small river town', CHUNK_A_TEXT), 'exact');
  });

  test('exact: different case', () => {
    assert.equal(checkQuote('ADA WAS BORN IN EXAMPLETON', CHUNK_A_TEXT), 'exact');
  });

  test('exact: different punctuation', () => {
    assert.equal(checkQuote('Ada was born; in Exampleton... a small river town', CHUNK_A_TEXT), 'exact');
  });

  test('exact: curly quotes around the quote and curly apostrophes', () => {
    assert.equal(checkQuote('“Ada was born in Exampleton”', CHUNK_A_TEXT), 'exact');
    const text = "Ada's father said it's a fine day for sailing.";
    assert.equal(checkQuote('Ada’s father said it’s a fine day', text), 'exact');
  });

  test('close: not a substring but at least 80% of quote words are in the chunk', () => {
    // 7 words >= 3 letters, 6 present in the chunk (86%)
    assert.equal(checkQuote('ada born exampleton small river town zeppelin', CHUNK_A_TEXT), 'close');
  });

  test('missing: unrelated quote', () => {
    assert.equal(checkQuote('completely unrelated submarine cargo manifest', CHUNK_A_TEXT), 'missing');
  });

  test('missing: quote from a different chunk', () => {
    assert.equal(checkQuote('dangerous storm struck on the twelfth night', CHUNK_A_TEXT), 'missing');
  });

  test('missing: empty quote', () => {
    assert.equal(checkQuote('', CHUNK_A_TEXT), 'missing');
  });
});

describe('screenFacts', () => {
  test('keeps a fact with a known id and exact quote, and adds quoteCheck', () => {
    const facts = [{ fact: 'Ada was born in 1801.', chunkIds: ['D01-C0000'], quote: 'Ada was born in Exampleton' }];
    const { kept, rejected } = screenFacts(facts, chunks);
    assert.equal(rejected.length, 0);
    assert.equal(kept.length, 1);
    assert.equal(kept[0].fact, 'Ada was born in 1801.');
    assert.deepEqual(kept[0].chunkIds, ['D01-C0000']);
    assert.equal(kept[0].quote, 'Ada was born in Exampleton');
    assert.equal(kept[0].quoteCheck, 'exact');
  });

  test('kept fact with an approximate quote gets quoteCheck "close"', () => {
    const facts = [
      { fact: 'Ada was born in a river town.', chunkIds: ['D01-C0000'], quote: 'ada born exampleton small river town zeppelin' },
    ];
    const { kept, rejected } = screenFacts(facts, chunks);
    assert.equal(rejected.length, 0);
    assert.equal(kept.length, 1);
    assert.equal(kept[0].quoteCheck, 'close');
  });

  test('unknown chunk ids are stripped from chunkIds while known ones stay', () => {
    const facts = [
      { fact: 'Ada was born in Exampleton.', chunkIds: ['D99-C0042', 'D01-C0000'], quote: 'Ada was born in Exampleton' },
    ];
    const { kept, rejected } = screenFacts(facts, chunks);
    assert.equal(rejected.length, 0);
    assert.equal(kept.length, 1);
    assert.deepEqual(kept[0].chunkIds, ['D01-C0000']);
  });

  test('a fact whose ids are all unknown is rejected with reason "unknown-citation"', () => {
    const facts = [{ fact: 'Something invented.', chunkIds: ['D99-C0001', 'D98-C0002'], quote: 'Ada was born in Exampleton' }];
    const { kept, rejected } = screenFacts(facts, chunks);
    assert.equal(kept.length, 0);
    assert.equal(rejected.length, 1);
    assert.equal(rejected[0].reason, 'unknown-citation');
    assert.equal(rejected[0].fact, 'Something invented.');
  });

  test('a fact with no chunk ids at all is rejected with "unknown-citation"', () => {
    const facts = [{ fact: 'No sources.', chunkIds: [], quote: 'Ada was born in Exampleton' }];
    const { kept, rejected } = screenFacts(facts, chunks);
    assert.equal(kept.length, 0);
    assert.equal(rejected[0].reason, 'unknown-citation');
  });

  test('a quote missing from the cited chunk is rejected with "quote-not-found"', () => {
    const facts = [{ fact: 'Ada loved submarines.', chunkIds: ['D01-C0000'], quote: 'completely unrelated submarine cargo manifest' }];
    const { kept, rejected } = screenFacts(facts, chunks);
    assert.equal(kept.length, 0);
    assert.equal(rejected.length, 1);
    assert.equal(rejected[0].reason, 'quote-not-found');
  });

  test('a quote present only in an uncited chunk is rejected with "quote-not-found"', () => {
    const facts = [{ fact: 'There was a storm.', chunkIds: ['D01-C0000'], quote: 'a dangerous storm struck on the twelfth night' }];
    const { kept, rejected } = screenFacts(facts, chunks);
    assert.equal(kept.length, 0);
    assert.equal(rejected[0].reason, 'quote-not-found');
  });

  test('a quote found in any one of several cited chunks is kept', () => {
    const facts = [
      { fact: 'There was a storm.', chunkIds: ['D01-C0000', 'D01-C0001'], quote: 'a dangerous storm struck on the twelfth night' },
    ];
    const { kept, rejected } = screenFacts(facts, chunks);
    assert.equal(rejected.length, 0);
    assert.equal(kept.length, 1);
    assert.equal(kept[0].quoteCheck, 'exact');
  });

  test('mixed batch is split into kept and rejected', () => {
    const facts = [
      { fact: 'Good one.', chunkIds: ['D01-C0000'], quote: 'Her father kept a shop' },
      { fact: 'Bad id.', chunkIds: ['D77-C0001'], quote: 'Her father kept a shop' },
      { fact: 'Bad quote.', chunkIds: ['D01-C0001'], quote: 'a purple elephant danced' },
    ];
    const { kept, rejected } = screenFacts(facts, chunks);
    assert.deepEqual(kept.map((f) => f.fact), ['Good one.']);
    assert.deepEqual(rejected.map((f) => f.reason).sort(), ['quote-not-found', 'unknown-citation']);
  });

  test('empty facts gives empty kept and rejected', () => {
    const { kept, rejected } = screenFacts([], chunks);
    assert.deepEqual(kept, []);
    assert.deepEqual(rejected, []);
  });
});

describe('deterministicFlags', () => {
  const allowed = new Set(['D01-C0000', 'D01-C0001']);

  test('no flags for a sentence citing only allowed ids', () => {
    assert.deepEqual(deterministicFlags({ text: 'Fine.', chunkIds: ['D01-C0000'] }, allowed), []);
  });

  test('"no-citation" when chunkIds is empty', () => {
    const flags = deterministicFlags({ text: 'Uncited.', chunkIds: [] }, allowed);
    assert.ok(flags.includes('no-citation'));
    assert.ok(!flags.includes('unknown-citation'));
  });

  test('"unknown-citation" when an id is not in allowedIds', () => {
    const flags = deterministicFlags({ text: 'Made up.', chunkIds: ['D09-C0009'] }, allowed);
    assert.ok(flags.includes('unknown-citation'));
    assert.ok(!flags.includes('no-citation'));
  });

  test('"unknown-citation" when only some of the ids are unknown', () => {
    const flags = deterministicFlags({ text: 'Partly made up.', chunkIds: ['D01-C0000', 'D09-C0009'] }, allowed);
    assert.ok(flags.includes('unknown-citation'));
  });
});

describe('splitSentences', () => {
  test('three plain sentences give 3', () => {
    const out = splitSentences('Ada was born in Exampleton. She became a printer. She died in 1870.');
    assert.equal(out.length, 3);
    assert.ok(out[0].includes('born in Exampleton'));
    assert.ok(out[1].includes('became a printer'));
    assert.ok(out[2].includes('died in 1870'));
  });

  test('a single sentence gives 1', () => {
    assert.equal(splitSentences('Ada was born in Exampleton.').length, 1);
  });
});

// ---------------------------------------------------------------------------
// unmatchedTerms (deterministic training-data tell, added after the log review)
// ---------------------------------------------------------------------------
import { unmatchedTerms } from '../src/verify.js';

describe('unmatchedTerms', () => {
  const chunk = 'He was born in Boston on the 17th of January 1706, the son of Josiah, a tallow-chandler.';
  test('names and numbers present in the cited chunk pass', () => {
    assert.deepEqual(unmatchedTerms('He was born in Boston in January 1706.', [chunk]), []);
  });
  test('a name absent from the cited chunk is reported', () => {
    assert.deepEqual(unmatchedTerms('He was born in Boston to Josiah and Abiah Folger.', [chunk]), ['Abiah', 'Folger']);
  });
  test('a number absent from the cited chunk is reported', () => {
    assert.deepEqual(unmatchedTerms('He died in 1790.', [chunk]), ['1790']);
  });
  test('the first word of a sentence and ignored name words are skipped', () => {
    assert.deepEqual(unmatchedTerms('Young Franklin lived in Boston.', [chunk], ['franklin']), []);
  });
  test('possessives are matched on the base name', () => {
    assert.deepEqual(unmatchedTerms("It was Josiah's trade.", [chunk]), []);
  });
});

describe('unmatchedTerms ordinals', () => {
  test('"17" matches "17th" in the source', () => {
    assert.deepEqual(unmatchedTerms('He was born on January 17, 1706.', ['born on the 17th of January 1706']), []);
  });
});
