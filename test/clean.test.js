import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { stripGutenberg, toParagraphs } from '../src/clean.js';

describe('stripGutenberg', () => {
  const wrapped = [
    'The Project Gutenberg eBook of A Life',
    'Some license header text.',
    '*** START OF THE PROJECT GUTENBERG EBOOK A LIFE ***',
    '',
    'Chapter One',
    '',
    'She was born in a small town.',
    '',
    '*** END OF THE PROJECT GUTENBERG EBOOK A LIFE ***',
    'Full license text follows here.',
  ].join('\n');

  test('drops everything up to and including the START line', () => {
    const out = stripGutenberg(wrapped);
    assert.ok(!out.includes('START OF THE PROJECT GUTENBERG'));
    assert.ok(!out.includes('Some license header text'));
    assert.ok(!out.includes('The Project Gutenberg eBook of A Life'));
    assert.ok(out.includes('Chapter One'));
  });

  test('drops everything from the END line on', () => {
    const out = stripGutenberg(wrapped);
    assert.ok(!out.includes('END OF THE PROJECT GUTENBERG'));
    assert.ok(!out.includes('Full license text follows here'));
    assert.ok(out.includes('She was born in a small town.'));
  });

  test('accepts the "THIS PROJECT GUTENBERG" marker variant', () => {
    const text = [
      'header junk',
      '*** START OF THIS PROJECT GUTENBERG EBOOK SOMETHING ***',
      'The real body text.',
      '*** END OF THIS PROJECT GUTENBERG EBOOK SOMETHING ***',
      'footer junk',
    ].join('\n');
    const out = stripGutenberg(text);
    assert.ok(out.includes('The real body text.'));
    assert.ok(!out.includes('header junk'));
    assert.ok(!out.includes('footer junk'));
  });

  test('returns the input unchanged when there are no markers', () => {
    const text = 'Just a plain page.\n\nWith two paragraphs.';
    assert.equal(stripGutenberg(text), text);
  });

  test('returns an empty string unchanged', () => {
    assert.equal(stripGutenberg(''), '');
  });
});

describe('toParagraphs', () => {
  test('splits on blank lines and collapses inner whitespace', () => {
    const out = toParagraphs('First   paragraph\nspans two lines.\n\nSecond paragraph.');
    assert.deepEqual(out, ['First paragraph spans two lines.', 'Second paragraph.']);
  });

  test('normalizes CRLF line endings', () => {
    const out = toParagraphs('One line.\r\n\r\nAnother line.\r\nContinued.');
    assert.equal(out.length, 2);
    assert.equal(out[0], 'One line.');
    assert.equal(out[1], 'Another line. Continued.');
    assert.ok(out.every((p) => !p.includes('\r')));
  });

  test('drops empty paragraphs (extra blank lines, whitespace-only blocks)', () => {
    const out = toParagraphs('\n\n\nAlpha.\n\n   \n\n\nBeta.\n\n\n');
    assert.deepEqual(out, ['Alpha.', 'Beta.']);
  });

  test('returns [] for empty input', () => {
    assert.deepEqual(toParagraphs(''), []);
  });

  test('removes _italic_ underscores but keeps the words', () => {
    const out = toParagraphs('She read _The Voyage Home_ twice and _loved_ it.');
    assert.equal(out.length, 1);
    assert.equal(out[0], 'She read The Voyage Home twice and loved it.');
    assert.ok(!out[0].includes('_'));
  });

  test('removes soft hyphens', () => {
    const out = toParagraphs('The co­operative met in the ware­house.');
    assert.equal(out.length, 1);
    assert.ok(!out[0].includes('­'));
    assert.equal(out[0], 'The cooperative met in the warehouse.');
  });

  test('joins "word-\\nword" across lines only when pdf is true', () => {
    const input = 'The inter-\nesting letter arrived on a Tuesday.';
    const pdf = toParagraphs(input, { pdf: true });
    assert.equal(pdf.length, 1);
    assert.ok(pdf[0].includes('interesting'), `expected joined word in: ${pdf[0]}`);

    const plain = toParagraphs(input);
    assert.equal(plain.length, 1);
    assert.ok(!plain[0].includes('interesting'), `should not join without pdf: ${plain[0]}`);
    assert.ok(plain[0].includes('inter-'));

    const explicitFalse = toParagraphs(input, { pdf: false });
    assert.ok(!explicitFalse[0].includes('interesting'));
  });

  test('drops an index-like paragraph (>15 words, >=30% numeric tokens)', () => {
    const indexLike = 'Adams 12 14 22 31 45 Baker 8 19 27 33 41 Clark 5 9 16 28 40 55';
    const normal = 'This is a perfectly ordinary paragraph about a quiet afternoon by the river.';
    const out = toParagraphs(`${normal}\n\n${indexLike}\n\n${normal}`);
    assert.equal(out.length, 2);
    assert.ok(out.every((p) => p === normal));
  });

  test('keeps a normal paragraph that mentions a few years', () => {
    const para =
      'In 1801 she was born in Exampleton, and by 1815 she had left school to work for a printer, ' +
      'who later moved the shop across the river in 1822 because the old building was damp and crowded.';
    const out = toParagraphs(para);
    assert.equal(out.length, 1);
    assert.equal(out[0], para);
  });
});
