// HTTP API + static frontend.
import crypto from 'node:crypto';
import path from 'node:path';
import express from 'express';
import compression from 'compression';
import multer from 'multer';
import { cfg } from './config.js';
import { isSupported } from './extract.js';
import { enqueue, ingestDocument, progress } from './ingest.js';
import { runStory, runAsk } from './generate.js';
import { getLog, logToMarkdown, storyToMarkdown } from './log.js';
import { assertBudget, rateLimit, spentToday } from './budget.js';
import { loadChunks } from './retrieve.js';

const newId = (prefix) => `${prefix}${crypto.randomBytes(6).toString('base64url').replace(/[-_]/g, '').slice(0, 8).toLowerCase()}`;
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

const asyncH = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const docOut = (d, collectionId) => ({
  id: d.id, seq: d.seq, filename: d.filename, bytes: d.bytes, words: d.words, estPages: d.est_pages, chunks: d.chunks,
  status: d.status, error: d.error, progress: progress.get(`${collectionId}/${d.id}`) || null,
});

const runOut = (r) => ({
  id: r.id, collectionId: r.collection_id, kind: r.kind, question: r.question, status: r.status, progress: r.progress,
  result: r.result, costUsd: Number(r.cost_usd || 0), error: r.error, createdAt: r.created_at, finishedAt: r.finished_at,
});

export function createApp({ db, llm, logger = console }) {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(compression());
  app.use(express.json({ limit: '64kb' }));

  const ip = (req) => req.ip || 'unknown';
  const activeStoryRuns = new Set();

  async function getCollection(id) {
    const r = await db.query('select * from collections where id = $1', [id]);
    if (!r.rows[0]) throw new HttpError(404, 'No collection with that ID.');
    return r.rows[0];
  }
  function assertOwner(req, c) {
    const t = req.get('x-owner-token');
    if (!t || sha(t) !== c.owner_hash) throw new HttpError(403, 'Only the browser that created this collection can change it.');
  }

  app.get('/healthz', asyncH(async (_req, res) => {
    await db.query('select 1');
    res.json({ ok: true, provider: llm.provider, db: db.kind, chatModel: llm.chatModel, embedModel: llm.embedModel, spentTodayUsd: Number((await spentToday(db)).toFixed(4)), dailyBudgetUsd: cfg.dailyBudgetUsd });
  }));

  app.get('/api/collections', asyncH(async (_req, res) => {
    const rows = (await db.query(`
      select c.id, c.person, c.aliases, c.created_at,
             count(d.id)::int as documents, coalesce(sum(d.chunks),0)::int as chunks,
             coalesce(sum(d.words),0)::int as words, coalesce(sum(d.est_pages),0)::int as est_pages
        from collections c left join documents d on d.collection_id = c.id
       group by c.id order by c.created_at desc limit 30`)).rows;
    res.json({ collections: rows.map((r) => ({ id: r.id, person: r.person, aliases: r.aliases, documents: r.documents, chunks: r.chunks, words: r.words, estPages: r.est_pages, createdAt: r.created_at })) });
  }));

  app.post('/api/collections', asyncH(async (req, res) => {
    const person = String(req.body?.person ?? '').replace(/\s+/g, ' ').trim();
    const rawAliases = Array.isArray(req.body?.aliases) ? req.body.aliases.join(', ') : req.body?.aliases;
    const aliases = String(rawAliases ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
    if (!person) throw new HttpError(400, 'Enter the name of the person the pages are about.');
    if (person.length > 120) throw new HttpError(400, 'That name is too long (120 characters at most).');
    rateLimit('collection', ip(req), cfg.limits.collectionsPerHour);
    const id = newId('c');
    const ownerToken = crypto.randomBytes(24).toString('base64url');
    await db.query('insert into collections (id, person, aliases, owner_hash) values ($1,$2,$3,$4)', [id, person, aliases, sha(ownerToken)]);
    res.status(201).json({ id, person, aliases, ownerToken });
  }));

  app.get('/api/collections/:id', asyncH(async (req, res) => {
    const c = await getCollection(req.params.id);
    const docs = (await db.query('select * from documents where collection_id = $1 order by seq', [c.id])).rows.map((d) => docOut(d, c.id));
    const runs = (await db.query(`select id, kind, question, status, created_at, cost_usd from runs where collection_id = $1 order by created_at desc limit 50`, [c.id])).rows;
    res.json({
      collection: { id: c.id, person: c.person, aliases: c.aliases, createdAt: c.created_at },
      documents: docs,
      totals: {
        documents: docs.length,
        chunks: docs.reduce((a, d) => a + d.chunks, 0),
        words: docs.reduce((a, d) => a + d.words, 0),
        estPages: docs.reduce((a, d) => a + d.estPages, 0),
      },
      runs: runs.map((r) => ({ id: r.id, kind: r.kind, question: r.question, status: r.status, createdAt: r.created_at, costUsd: Number(r.cost_usd || 0) })),
    });
  }));

  app.delete('/api/collections/:id', asyncH(async (req, res) => {
    const c = await getCollection(req.params.id);
    assertOwner(req, c);
    await db.query('delete from collections where id = $1', [c.id]);
    res.status(204).end();
  }));

  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: cfg.maxFileBytes, files: cfg.maxFiles } });
  app.post('/api/collections/:id/files',
    asyncH(async (req, _res, next) => {
      const c = await getCollection(req.params.id);
      assertOwner(req, c);
      const len = Number(req.get('content-length') || 0);
      if (len > cfg.maxRequestBytes) throw new HttpError(413, `Upload at most ${cfg.maxRequestBytes / 1024 / 1024} MB at a time. Split the files into several uploads.`);
      rateLimit('upload', ip(req), cfg.limits.uploadsPerHour);
      await assertBudget(db);
      req.collection = c;
      next();
    }),
    (req, res, next) => upload.array('files', cfg.maxFiles)(req, res, (err) => {
      if (!err) return next();
      if (err.code === 'LIMIT_FILE_SIZE') return next(new HttpError(413, `Each file can be at most ${cfg.maxFileBytes / 1024 / 1024} MB.`));
      if (err.code === 'LIMIT_FILE_COUNT') return next(new HttpError(413, `Upload at most ${cfg.maxFiles} files at a time.`));
      return next(new HttpError(400, `Upload failed: ${err.message}`));
    }),
    asyncH(async (req, res) => {
      const c = req.collection;
      const files = req.files || [];
      if (!files.length) throw new HttpError(400, 'Choose at least one file to add.');
      const bad = files.filter((f) => !isSupported(f.originalname));
      if (bad.length) throw new HttpError(415, `${bad.map((f) => `"${f.originalname}"`).join(', ')} isn't a supported file. Use .txt, .md, .html, .pdf or .docx.`);
      const maxSeq = Number((await db.query('select coalesce(max(seq),0)::int as m from documents where collection_id = $1', [c.id])).rows[0].m);
      const docs = [];
      for (const [i, f] of files.entries()) {
        const seq = maxSeq + i + 1;
        const doc = { id: `D${String(seq).padStart(2, '0')}`, seq, filename: path.basename(Buffer.from(f.originalname, 'latin1').toString('utf8')).slice(0, 200), bytes: f.size };
        await db.query('insert into documents (collection_id, id, seq, filename, bytes) values ($1,$2,$3,$4,$5)', [c.id, doc.id, seq, doc.filename, doc.bytes]);
        docs.push(doc);
        const buffer = f.buffer;
        enqueue(() => ingestDocument(db, llm, { collectionId: c.id, doc, buffer, log: logger }));
      }
      const rows = (await db.query('select * from documents where collection_id = $1 and id = any($2::text[]) order by seq', [c.id, docs.map((d) => d.id)])).rows;
      res.status(202).json({ documents: rows.map((d) => docOut(d, c.id)) });
    }));

  app.get('/api/collections/:id/chunks/:chunkId', asyncH(async (req, res) => {
    const c = await getCollection(req.params.id);
    const m = await loadChunks(db, c.id, [req.params.chunkId]);
    if (!m[req.params.chunkId]) throw new HttpError(404, 'No chunk with that ID.');
    res.json({ chunk: m[req.params.chunkId] });
  }));

  async function readyCheck(c) {
    const r = (await db.query(`select count(*) filter (where status = 'ready')::int as ready,
                                      count(*) filter (where status in ('queued','extracting','embedding'))::int as busy
                                 from documents where collection_id = $1`, [c.id])).rows[0];
    if (!r.ready) throw new HttpError(400, r.busy ? 'The pages are still being processed. Wait until they show as ready.' : 'Add some pages first.');
  }

  app.post('/api/collections/:id/runs', asyncH(async (req, res) => {
    const c = await getCollection(req.params.id);
    await readyCheck(c);
    if (activeStoryRuns.size >= 2) throw new HttpError(429, 'Two stories are being written right now. Try again in a minute.');
    rateLimit('story', ip(req), cfg.limits.storyRunsPerHour);
    await assertBudget(db);
    const runId = newId('r');
    await db.query(`insert into runs (id, collection_id, kind, status, progress) values ($1,$2,'story','running',$3)`, [runId, c.id, JSON.stringify({ stage: 'retrieving', questionsDone: 0, questionsTotal: 20 })]);
    activeStoryRuns.add(runId);
    runStory({ db, llm, collection: c, runId })
      .catch(async (e) => {
        logger.error?.({ err: e.message, runId }, 'story run failed');
        await db.query(`update runs set status = 'error', error = $2, finished_at = now() where id = $1`, [runId, `The story run failed: ${e.message}`]).catch(() => {});
      })
      .finally(() => activeStoryRuns.delete(runId));
    res.status(202).json({ runId });
  }));

  app.post('/api/collections/:id/ask', asyncH(async (req, res) => {
    const c = await getCollection(req.params.id);
    const question = String(req.body?.question ?? '').replace(/\s+/g, ' ').trim();
    if (!question) throw new HttpError(400, 'Type a question first.');
    if (question.length > 500) throw new HttpError(400, 'Keep the question under 500 characters.');
    await readyCheck(c);
    rateLimit('ask', ip(req), cfg.limits.asksPerHour);
    await assertBudget(db);
    const runId = newId('q');
    await db.query(`insert into runs (id, collection_id, kind, question, status) values ($1,$2,'ask',$3,'running')`, [runId, c.id, question]);
    try {
      const result = await runAsk({ db, llm, collection: c, runId, question });
      res.json({ runId, result });
    } catch (e) {
      await db.query(`update runs set status = 'error', error = $2, finished_at = now() where id = $1`, [runId, e.message]).catch(() => {});
      throw e;
    }
  }));

  async function getRun(id) {
    const r = await db.query('select r.*, c.person from runs r join collections c on c.id = r.collection_id where r.id = $1', [id]);
    if (!r.rows[0]) throw new HttpError(404, 'No run with that ID.');
    return r.rows[0];
  }

  app.get('/api/runs/:id', asyncH(async (req, res) => {
    const r = await getRun(req.params.id);
    res.json({ run: { ...runOut(r), person: r.person } });
  }));

  app.get('/api/runs/:id/log.json', asyncH(async (req, res) => {
    const r = await getRun(req.params.id);
    const entries = await getLog(db, r.id);
    res.set('Content-Disposition', `attachment; filename="log-${r.id}.json"`);
    res.json({ run: { ...runOut(r), person: r.person }, entries });
  }));

  app.get('/api/runs/:id/log.md', asyncH(async (req, res) => {
    const r = await getRun(req.params.id);
    const entries = await getLog(db, r.id);
    res.set('Content-Type', 'text/markdown; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="log-${r.id}.md"`);
    res.send(logToMarkdown({ ...runOut(r), person: r.person }, entries));
  }));

  app.get('/api/runs/:id/story.md', asyncH(async (req, res) => {
    const r = await getRun(req.params.id);
    if (r.kind !== 'story' || r.status !== 'done') throw new HttpError(400, 'This run has no finished story.');
    const docs = (await db.query('select * from documents where collection_id = $1 order by seq', [r.collection_id])).rows.map((d) => docOut(d, r.collection_id));
    res.set('Content-Type', 'text/markdown; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="story-${r.id}.md"`);
    res.send(storyToMarkdown({ ...runOut(r), person: r.person }, docs));
  }));

  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Unknown API route.')));
  app.use(express.static(new URL('../public', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), { extensions: ['html'], maxAge: '5m' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    const status = err.status || err.statusCode || 500;
    if (status >= 500) logger.error?.({ err: err.message, stack: err.stack, path: req.path }, 'request failed');
    res.status(status).json({ error: status >= 500 && !err.expose ? `Something went wrong on the server: ${err.message}` : err.message });
  });
  return app;
}
