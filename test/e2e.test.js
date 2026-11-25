// End-to-end flow in mock mode: create collection, upload, ingest, run 20 questions, inspect logs, ask.
// Env must be set BEFORE the app modules are imported.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.LLM_PROVIDER = 'mock';
delete process.env.DATABASE_URL;

const { openDb } = await import('../src/db.js');
const { makeLlm } = await import('../src/llm.js');
const { createApp } = await import('../src/app.js');

const NOT_IN_SOURCES = 'Not in the sources.';
const PERSON = 'Ada Testperson';

// ---------------------------------------------------------------------------
// Fictional biography text (~3,000 words). Deliberately never uses the words
// "brand", "smartphone" or "own" (the canary question relies on that).
// ---------------------------------------------------------------------------
const CORE = [
  'Ada Testperson was born on 3 March 1801 in the river town of Exampleton. Her father, Edmund Testperson, kept a small shop that sold rope, lamp oil, and paper. Her mother, Clara Testperson, taught the neighborhood children to read at the kitchen table. The house stood close to the water, and Ada often fell asleep to the sound of barges passing in the night.',
  'Ada had three siblings. Her older brother Walter helped in the shop, her younger sister Mabel loved to sing in the church choir, and her youngest brother Oswin was often ill as a child. The four children shared two rooms above the shop, and winters there were cold and crowded.',
  'Ada attended the Exampleton parish school from the age of six until the age of twelve. Her teacher, Miss Harriet Penwright, praised her handwriting and her skill with sums. Ada read every book in the school cupboard twice, and she borrowed more from the vicar.',
  'At thirteen Ada became a printer\'s apprentice at the workshop of Mr. Jonas Albright on Mill Street. This was her first job. She learned to set type, mix ink, and operate the heavy iron press. The work was hard, her fingers were stained black by evening, and she was paid three shillings a week.',
  'In 1824 Ada sailed on the ship Marigold to the port of Larkhaven, where a new printing house had offered her a position. The voyage lasted nineteen days. She kept a small notebook during the trip and wrote down the names of the sailors, the colors of the sunsets, and the food served each day.',
  'On the twelfth night of the voyage a dangerous storm struck the Marigold. The waves broke over the deck, and the main mast cracked with a sound like thunder. Ada helped the crew carry water from the hold all night, and the captain, Samuel Reed, thanked her afterwards. She said later that the storm was the most frightening night of her life.',
  'In 1829 Ada married Thomas Holloway, a clockmaker, in the stone church at Larkhaven. The wedding was small. Her friend Lucy Fairweather played the church organ, and Thomas gave Ada a pocket watch that she carried for the rest of her days.',
  'Ada and Thomas had two children. Their daughter Eleanor was born in 1831, and their son Henry was born in 1834. Eleanor grew up to become a schoolteacher, and Henry became a ship\'s carpenter and sailed to many distant harbors.',
  'Ada\'s closest friends were the botanist Lucy Fairweather and the bookseller Arthur Quill. Lucy brought her pressed flowers from the hills, and Arthur lent her new books every month. The three of them met on Thursday evenings to talk, drink tea, and argue about politics.',
  'Ada\'s chief rival was the printer Rupert Blackwood, who copied her page designs and spread rumors that her prices were too high. The rivalry lasted for twenty years. Once he even hired away two of her best workers. Ada never answered him in public, and she simply printed better books.',
  'In 1838 Ada invented a folding type tray that kept metal letters in order and saved hours of work. She called it the Quick Case. Printers in many towns bought it, and the invention made her modestly wealthy. She used the money to hire more apprentices and to buy a larger press.',
  'In the 1840s Ada traveled by coach and canal boat to Marshby, Eastmoor, and the hill village of Pellow. She visited printers, sold her trays, and collected stories from the people she met. These journeys took her away from home for weeks at a time.',
  'Every morning Ada drank a cup of weak tea and walked along the river for half an hour before starting work. She never missed this walk, even in the rain or snow. She said that her best ideas came to her on the path beside the water.',
  'Ada Testperson died on 19 November 1870 in Larkhaven, at the age of sixty-nine. She was buried beside her husband in the churchyard. Hundreds of printers, neighbors, and former apprentices came to the funeral, and the shops on the main street closed for the day.',
];

const TOWNS = ['Marshby', 'Eastmoor', 'Pellow', 'Larkhaven', 'Exampleton', 'Dunwick', 'Harrowgate', 'Millbrook'];
const WARES = ['posters', 'ledgers', 'almanacs', 'school primers', 'hymn books', 'market notices', 'maps', 'recipe cards'];
const PEOPLE = ['a baker named Cora', 'a farmer called Silas', 'the mayor, Mr. Greaves', 'a weaver named Ines', 'a ferryman called Odell', 'a young clerk named Perry'];
const WEATHER = ['a cold wind', 'a week of rain', 'bright warm sunshine', 'thick fog', 'early snow', 'a heavy summer heat'];
const THOUGHTS = [
  'She wrote in her notebook that patience was the main skill of a good printer.',
  'She noted that every town had its own favorite kind of paper.',
  'She decided to charge a fair price and to keep her promises about the delivery day.',
  'She remarked that the roads were worse than the previous year.',
  'She enjoyed the quiet evenings at the inn, where she mended her tools by the fire.',
  'She felt grateful that her apprentices were looking after the shop at home.',
];

function fillerParagraph(i) {
  const year = 1832 + (i % 36);
  const town = TOWNS[i % TOWNS.length];
  const ware = WARES[(i * 3) % WARES.length];
  const person = PEOPLE[(i * 5) % PEOPLE.length];
  const weather = WEATHER[(i * 7) % WEATHER.length];
  const thought = THOUGHTS[(i * 11) % THOUGHTS.length];
  const days = 2 + (i % 5);
  return (
    `In the year ${year} Ada traveled to ${town} to deliver a large order of ${ware}. ` +
    `She stayed for ${days} days, and the whole visit was marked by ${weather}. ` +
    `During her stay she spoke at length with ${person}, who asked many questions about the printing trade and about the long road from Larkhaven. ` +
    `${thought} ` +
    `When the order had been counted and paid for, she packed her satchel, thanked her hosts, and returned home with a lighter cart and a heavier purse.`
  );
}

function buildBiography() {
  const paras = [...CORE];
  for (let i = 0; i < 38; i++) paras.push(fillerParagraph(i));
  return paras.join('\n\n') + '\n';
}

const BIOGRAPHY = buildBiography();

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
async function until(fn, { timeoutMs, intervalMs = 250, label }) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeoutMs) {
    last = await fn();
    if (last.done) return last.value;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Timed out after ${timeoutMs} ms waiting for: ${label}. Last state: ${JSON.stringify(last?.value ?? null).slice(0, 500)}`);
}

function textUpload(filename, text, type = 'text/plain') {
  const form = new FormData();
  form.append('files', new Blob([text], { type }), filename);
  return form;
}

describe('Biography RAG end to end (mock LLM, PGlite)', () => {
  let db;
  let llm;
  let server;
  let base;
  let collectionId;
  let ownerToken;
  let runId;
  let runResult;

  const api = (path, init) => fetch(`${base}${path}`, init);
  const json = (path, body, headers = {}) =>
    api(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });

  before(async () => {
    // sanity guards on the generated fixture
    const words = BIOGRAPHY.split(/\s+/).filter(Boolean).length;
    assert.ok(words >= 2500, `fixture should be about 3000 words, got ${words}`);
    assert.ok(!/\b(brand|smartphone)\b/i.test(BIOGRAPHY), 'fixture must not contain canary words');

    db = await openDb();
    llm = makeLlm();
    const app = createApp({ db, llm });
    await new Promise((resolve, reject) => {
      server = app.listen(0, '127.0.0.1', resolve);
      server.once('error', reject);
    });
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections?.();
      });
    }
    if (db) await db.close();
  });

  test('POST /api/collections creates a collection and returns an owner token', async () => {
    const res = await json('/api/collections', { person: PERSON });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(typeof body.id, 'string');
    assert.ok(body.id.length > 0);
    assert.equal(typeof body.ownerToken, 'string');
    assert.ok(body.ownerToken.length > 0);
    assert.equal(body.person, PERSON);
    collectionId = body.id;
    ownerToken = body.ownerToken;
  });

  test('POST /api/collections without a person is 400', async () => {
    const res = await json('/api/collections', {});
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(typeof body.error, 'string');
  });

  test('uploading without an owner token is 403', async () => {
    const res = await api(`/api/collections/${collectionId}/files`, {
      method: 'POST',
      body: textUpload('ada-biography.txt', BIOGRAPHY),
    });
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(typeof body.error, 'string');
  });

  test('uploading with a wrong owner token is 403', async () => {
    const res = await api(`/api/collections/${collectionId}/files`, {
      method: 'POST',
      headers: { 'X-Owner-Token': 'definitely-not-the-token' },
      body: textUpload('ada-biography.txt', BIOGRAPHY),
    });
    assert.equal(res.status, 403);
  });

  test('uploading an executable-named binary is 415', async () => {
    const bytes = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00, 0x04, 0x00, 0xff, 0xff]);
    const form = new FormData();
    form.append('files', new Blob([bytes], { type: 'application/octet-stream' }), 'installer.exe');
    const res = await api(`/api/collections/${collectionId}/files`, {
      method: 'POST',
      headers: { 'X-Owner-Token': ownerToken },
      body: form,
    });
    assert.equal(res.status, 415);
    const body = await res.json();
    assert.equal(typeof body.error, 'string');
  });

  test('uploading a .txt biography with the token is 202 and ingestion reaches "ready"', async () => {
    const res = await api(`/api/collections/${collectionId}/files`, {
      method: 'POST',
      headers: { 'X-Owner-Token': ownerToken },
      body: textUpload('ada-biography.txt', BIOGRAPHY),
    });
    assert.equal(res.status, 202);
    const body = await res.json();
    assert.ok(Array.isArray(body.documents));
    assert.equal(body.documents.length, 1);
    assert.equal(body.documents[0].filename, 'ada-biography.txt');

    const detail = await until(
      async () => {
        const r = await api(`/api/collections/${collectionId}`);
        assert.equal(r.status, 200);
        const d = await r.json();
        const doc = d.documents[0];
        if (doc && doc.status === 'error') throw new Error(`document ingestion failed: ${doc.error}`);
        return { done: doc && doc.status === 'ready', value: d };
      },
      { timeoutMs: 30_000, label: 'document status "ready"' },
    );

    assert.equal(detail.documents.length, 1);
    assert.equal(detail.documents[0].status, 'ready');
    assert.ok(detail.documents[0].chunks > 0, 'document should have chunks');
    assert.ok(detail.totals.chunks > 0, 'collection totals should count chunks');
    assert.equal(detail.collection.person, PERSON);
  });

  test('POST /runs starts a story run (202) and it finishes with 20 answered/unanswered questions', async () => {
    const res = await json(`/api/collections/${collectionId}/runs`, {});
    assert.equal(res.status, 202);
    const body = await res.json();
    assert.equal(typeof body.runId, 'string');
    runId = body.runId;

    const run = await until(
      async () => {
        const r = await api(`/api/runs/${runId}`);
        assert.equal(r.status, 200);
        const d = (await r.json()).run;
        if (d.status === 'error') throw new Error(`run failed: ${d.error}`);
        return { done: d.status === 'done', value: d };
      },
      { timeoutMs: 60_000, intervalMs: 400, label: 'story run status "done"' },
    );

    assert.equal(run.kind, 'story');
    assert.equal(run.collectionId, collectionId);
    runResult = run.result;
    assert.ok(runResult, 'run should have a result');
    assert.equal(runResult.person, PERSON);
    assert.equal(runResult.questions.length, 20);
  });

  test('story result: not-found questions say "Not in the sources."', () => {
    for (const q of runResult.questions) {
      if (q.found === false) {
        assert.equal(q.answer, NOT_IN_SOURCES, `question ${q.n} not found but answer is: ${q.answer}`);
      }
    }
  });

  test('story result: every story sentence cites chunk ids that exist in result.chunks', () => {
    const sections = runResult.story.sections;
    assert.ok(Array.isArray(sections));
    let sentenceCount = 0;
    for (const section of sections) {
      for (const s of section.sentences) {
        sentenceCount++;
        assert.ok(Array.isArray(s.chunkIds), 'sentence has chunkIds array');
        for (const id of s.chunkIds) {
          assert.ok(runResult.chunks[id], `story sentence cites ${id}, which is not in result.chunks: "${s.text}"`);
        }
      }
    }
    assert.ok(sentenceCount > 0, 'story should have at least one sentence');
  });

  test('story result: review coverage total is 20', () => {
    assert.equal(runResult.review.coverage.total, 20);
    assert.ok(runResult.review.coverage.found >= 0 && runResult.review.coverage.found <= 20);
  });

  test('GET /api/runs/:id/log.json has 20+ "extract" entries each with a prompt and retrieved list', async () => {
    const res = await api(`/api/runs/${runId}/log.json`);
    assert.equal(res.status, 200);
    const log = await res.json();
    assert.ok(Array.isArray(log.entries));
    const extracts = log.entries.filter((e) => e.step === 'extract');
    assert.ok(extracts.length >= 20, `expected at least 20 extract entries, got ${extracts.length}`);
    for (const e of extracts) {
      assert.notEqual(e.prompt, null, `extract entry ${e.seq} has null prompt`);
      assert.notEqual(e.prompt, undefined);
      assert.notEqual(e.retrieved, null, `extract entry ${e.seq} has null retrieved`);
      assert.notEqual(e.retrieved, undefined);
    }
  });

  test('GET /api/runs/:id/log.md returns 200 text', async () => {
    const res = await api(`/api/runs/${runId}/log.md`);
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.ok(text.length > 0);
  });

  test('GET /api/runs/:id/story.md returns 200 text', async () => {
    const res = await api(`/api/runs/${runId}/story.md`);
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.ok(text.length > 0);
  });

  test('canary: asking for a fact that is not in the sources returns found=false', async () => {
    const res = await json(`/api/collections/${collectionId}/ask`, {
      question: `What brand of smartphone did ${PERSON} own?`,
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(typeof body.runId, 'string');
    assert.equal(body.result.found, false);
    assert.equal(body.result.answer, NOT_IN_SOURCES);
  });

  test('asking about a documented fact returns found=true with at least one fact', async () => {
    const res = await json(`/api/collections/${collectionId}/ask`, {
      question: `Where was ${PERSON} born?`,
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.result.found, true);
    assert.ok(Array.isArray(body.result.facts));
    assert.ok(body.result.facts.length >= 1, 'expected at least one fact');
  });

  test('GET /api/collections/:id/chunks/:chunkId returns a retrieved chunk', async () => {
    const id = Object.keys(runResult.chunks)[0];
    assert.ok(id, 'run should have retrieved at least one chunk');
    const res = await api(`/api/collections/${collectionId}/chunks/${id}`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.chunk.id, id);
    assert.equal(typeof body.chunk.text, 'string');
  });
});
