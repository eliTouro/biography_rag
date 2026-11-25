import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { QUERIES, fillQuery } from '../src/queries.js';

describe('QUERIES', () => {
  test('there are exactly 20 queries', () => {
    assert.ok(Array.isArray(QUERIES));
    assert.equal(QUERIES.length, 20);
  });

  test('n runs from 1 to 20 with no gaps or repeats', () => {
    const ns = QUERIES.map((q) => q.n).sort((a, b) => a - b);
    assert.deepEqual(ns, Array.from({ length: 20 }, (_, i) => i + 1));
  });

  test('every query has a topic, a template and hints', () => {
    for (const q of QUERIES) {
      assert.equal(typeof q.topic, 'string', `query ${q.n} topic`);
      assert.ok(q.topic.length > 0, `query ${q.n} topic is empty`);
      assert.equal(typeof q.template, 'string', `query ${q.n} template`);
      assert.notEqual(q.hints, undefined, `query ${q.n} hints missing`);
    }
  });

  test('every template contains {person}', () => {
    for (const q of QUERIES) {
      assert.ok(q.template.includes('{person}'), `query ${q.n} template lacks {person}: ${q.template}`);
    }
  });

  test('templates are all distinct', () => {
    assert.equal(new Set(QUERIES.map((q) => q.template)).size, 20);
  });

  test('the first question is the birth question', () => {
    const first = QUERIES.find((q) => q.n === 1);
    assert.equal(first.template, 'Where and when was {person} born?');
  });
});

describe('fillQuery', () => {
  test('replaces the person placeholder', () => {
    assert.equal(fillQuery('Where and when was {person} born?', 'Ada Testperson'), 'Where and when was Ada Testperson born?');
  });

  test('replaces all occurrences', () => {
    const out = fillQuery('{person} met {person} and then {person} left.', 'Ada');
    assert.equal(out, 'Ada met Ada and then Ada left.');
    assert.ok(!out.includes('{person}'));
  });

  test('leaves templates without a placeholder unchanged', () => {
    assert.equal(fillQuery('No placeholder here.', 'Ada'), 'No placeholder here.');
  });

  test('filling every real template removes all placeholders and includes the name', () => {
    for (const q of QUERIES) {
      const out = fillQuery(q.template, 'Ada Testperson');
      assert.ok(!out.includes('{person}'), `query ${q.n} still has a placeholder`);
      assert.ok(out.includes('Ada Testperson'), `query ${q.n} lacks the name`);
    }
  });
});
