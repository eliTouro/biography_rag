import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { rrfMerge, buildTsQuery } from '../src/retrieve.js';

// tolerant: an implementation may round the score for display
const close = (a, b, eps = 1e-5) => Math.abs(a - b) < eps;
const tokens = (q) => (q === '' ? [] : q.split(' | '));

describe('rrfMerge', () => {
  test('computes rrf = sum of 1/(60+rank) with 1-based ranks', () => {
    const out = rrfMerge(['a', 'b', 'c'], ['b', 'a', 'd'], 10);
    const byId = Object.fromEntries(out.map((r) => [r.id, r]));
    assert.ok(close(byId.a.rrf, 1 / 61 + 1 / 62));
    assert.ok(close(byId.b.rrf, 1 / 62 + 1 / 61));
    assert.ok(close(byId.c.rrf, 1 / 63));
    assert.ok(close(byId.d.rrf, 1 / 63));
    assert.equal(byId.a.vecRank, 1);
    assert.equal(byId.a.ftsRank, 2);
    assert.equal(byId.b.vecRank, 2);
    assert.equal(byId.b.ftsRank, 1);
  });

  test('ranks are null when an id is absent from a list', () => {
    const out = rrfMerge(['a', 'b'], ['c'], 10);
    const byId = Object.fromEntries(out.map((r) => [r.id, r]));
    assert.equal(byId.a.ftsRank, null);
    assert.equal(byId.b.ftsRank, null);
    assert.equal(byId.c.vecRank, null);
    assert.equal(byId.c.ftsRank, 1);
    assert.equal(byId.a.vecRank, 1);
    assert.equal(byId.b.vecRank, 2);
    assert.ok(close(byId.c.rrf, 1 / 61));
  });

  test('a custom c constant is used', () => {
    const out = rrfMerge(['a'], [], 8, 10);
    assert.equal(out.length, 1);
    assert.ok(close(out[0].rrf, 1 / 11));
  });

  test('result is limited to k items (default 8)', () => {
    const ids = Array.from({ length: 20 }, (_, i) => `x${i}`);
    assert.equal(rrfMerge(ids, []).length, 8);
    assert.equal(rrfMerge(ids, ids.slice().reverse(), 5).length, 5);
    assert.equal(rrfMerge(ids, ids, 1).length, 1);
  });

  test('returns fewer than k when there are fewer distinct ids', () => {
    assert.equal(rrfMerge(['a', 'b'], ['b', 'c'], 8).length, 3);
  });

  test('is sorted by rrf descending; an id in both lists beats ids in only one', () => {
    const out = rrfMerge(['a', 'b', 'c'], ['c', 'd', 'e'], 10);
    for (let i = 1; i < out.length; i++) {
      assert.ok(out[i - 1].rrf >= out[i].rrf, 'not sorted descending');
    }
    assert.equal(out[0].id, 'c');
  });

  test('ties are broken by the better (lower) vecRank', () => {
    // a and b have identical rrf sums (1/61 + 1/62); a has the better vecRank
    const out = rrfMerge(['a', 'b'], ['b', 'a'], 10);
    assert.equal(out[0].id, 'a');
    assert.equal(out[1].id, 'b');
  });

  test('tie between a vec-only hit and an fts-only hit prefers the vec hit', () => {
    const out = rrfMerge(['v'], ['f'], 10);
    assert.ok(close(out[0].rrf, out[1].rrf));
    assert.equal(out[0].id, 'v');
    assert.equal(out[1].id, 'f');
  });

  test('both lists empty gives []', () => {
    assert.deepEqual(rrfMerge([], []), []);
  });
});

describe('buildTsQuery', () => {
  test('keeps content words and joins them with " | "', () => {
    const q = buildTsQuery('sail ocean harbor');
    assert.deepEqual(new Set(tokens(q)), new Set(['sail', 'ocean', 'harbor']));
    assert.equal(tokens(q).length, 3);
    assert.equal(q.split(' | ').join(' | '), q);
  });

  test('lowercases words', () => {
    const q = buildTsQuery('Harbor OCEAN');
    assert.deepEqual(new Set(tokens(q)), new Set(['harbor', 'ocean']));
  });

  test('removes English stopwords', () => {
    const q = buildTsQuery('where did the printer sail and when was the harbor');
    const t = new Set(tokens(q));
    for (const stop of ['the', 'and', 'did', 'was', 'when', 'where']) {
      assert.ok(!t.has(stop), `stopword "${stop}" survived`);
    }
    assert.ok(t.has('printer'));
    assert.ok(t.has('sail'));
    assert.ok(t.has('harbor'));
  });

  test('removes excluded name words case-insensitively', () => {
    const q = buildTsQuery('Where did Ada Testperson sail the ocean?', ['ADA', 'testperson']);
    const t = new Set(tokens(q));
    assert.ok(!t.has('ada'));
    assert.ok(!t.has('testperson'));
    assert.deepEqual(t, new Set(['sail', 'ocean']));
  });

  test('exclusion also matches when the question uses a different case than the list', () => {
    const q = buildTsQuery('ada ADA Ada voyage', ['Ada']);
    assert.deepEqual(tokens(q), ['voyage']);
  });

  test('dedupes repeated words', () => {
    const q = buildTsQuery('storm storm Storm STORM harbor');
    const t = tokens(q);
    assert.equal(t.length, 2);
    assert.deepEqual(new Set(t), new Set(['storm', 'harbor']));
  });

  test('ignores punctuation and digits', () => {
    const q = buildTsQuery('harbor, 1801; ocean! (1870)');
    assert.deepEqual(new Set(tokens(q)), new Set(['harbor', 'ocean']));
    assert.ok(!/\d/.test(q));
  });

  test('drops words shorter than 3 letters', () => {
    const q = buildTsQuery('ox is up harbor');
    assert.deepEqual(tokens(q), ['harbor']);
  });

  test('returns "" when nothing is left', () => {
    assert.equal(buildTsQuery('the and of'), '');
    assert.equal(buildTsQuery('1801 1870 ...'), '');
    assert.equal(buildTsQuery(''), '');
    assert.equal(buildTsQuery('Ada Testperson', ['ada', 'testperson']), '');
  });
});
