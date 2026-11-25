// Upload -> extract -> clean -> chunk -> embed -> store. One file at a time (memory-friendly on
// a 512 MB instance); live progress is kept in memory and statuses in the documents table.
import { cfg } from './config.js';
import { toVectorLiteral } from './db.js';
import { extractSections } from './extract.js';
import { toParagraphs } from './clean.js';
import { chunkParagraphs, chunkId, countWords } from './chunk.js';
import { addSpend } from './budget.js';
import { costOf } from './llm.js';

export const progress = new Map(); // `${collectionId}/${docId}` -> {done, total}

let queue = Promise.resolve();
export function enqueue(task) {
  const p = queue.then(task, task);
  queue = p.catch(() => {});
  return p;
}

async function setDoc(db, collectionId, docId, fields) {
  const keys = Object.keys(fields);
  const sets = keys.map((k, i) => `${k} = $${i + 3}`).join(', ');
  await db.query(`update documents set ${sets} where collection_id = $1 and id = $2`, [collectionId, docId, ...keys.map((k) => fields[k])]);
}

/** Build chunk records (no embeddings yet) from extracted sections. */
export function buildChunks(sections, kind, docSeq) {
  const out = [];
  let words = 0;
  // Chunk page by page for PDFs so each chunk keeps a page number; whole text otherwise.
  if (kind === 'pdf') {
    const paras = [];
    for (const s of sections) for (const p of toParagraphs(s.text, { pdf: true })) paras.push({ p, page: s.page });
    const texts = paras.map((x) => x.p);
    // Page of a chunk = page of its last paragraph, found by scanning forward from the previous chunk.
    let pi = 0;
    for (const c of chunkParagraphs(texts)) {
      const parts = c.text.split('\n\n');
      const probe = parts[parts.length - 1].slice(0, 60);
      let j = pi;
      while (j < paras.length && !paras[j].p.includes(probe)) j++;
      if (j < paras.length) pi = j;
      out.push({ ...c, page: paras[pi]?.page ?? null });
    }
    words = texts.reduce((a, t) => a + countWords(t), 0);
  } else {
    const paras = sections.flatMap((s) => toParagraphs(s.text));
    words = paras.reduce((a, t) => a + countWords(t), 0);
    for (const c of chunkParagraphs(paras)) out.push({ ...c, page: null });
  }
  return { words, chunks: out.map((c, i) => ({ ...c, id: chunkId(docSeq, i), ord: i })) };
}

export async function ingestDocument(db, llm, { collectionId, doc, buffer, log = console }) {
  const key = `${collectionId}/${doc.id}`;
  try {
    await setDoc(db, collectionId, doc.id, { status: 'extracting' });
    const { kind, sections } = await extractSections(buffer, doc.filename);
    const { words, chunks } = buildChunks(sections, kind, doc.seq);
    if (!chunks.length) throw Object.assign(new Error('No readable text found in this file. If it is a scanned PDF, it needs OCR first.'), { user: true });
    const existing = Number((await db.query('select count(*)::int as n from chunks where collection_id = $1', [collectionId])).rows[0].n);
    if (existing + chunks.length > cfg.maxChunksPerCollection) {
      throw Object.assign(new Error(`This collection would pass the ${cfg.maxChunksPerCollection.toLocaleString()}-chunk limit (about ${Math.round((cfg.maxChunksPerCollection * 220) / cfg.wordsPerPage).toLocaleString()} pages).`), { user: true });
    }
    await setDoc(db, collectionId, doc.id, { status: 'embedding', words, est_pages: Math.max(1, Math.round(words / cfg.wordsPerPage)) });
    progress.set(key, { done: 0, total: chunks.length });
    const BATCH = 96;
    let cost = 0;
    for (let i = 0; i < chunks.length; i += BATCH) {
      const batch = chunks.slice(i, i + BATCH);
      const { vectors, usage } = await llm.embed(batch.map((c) => c.text));
      cost += costOf(usage, 'embed');
      const params = [];
      const rows = batch.map((c, j) => {
        const b = j * 8;
        params.push(collectionId, c.id, doc.id, c.ord, c.page, c.words, c.text, toVectorLiteral(vectors[j]));
        return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}, $${b + 8}::vector)`;
      });
      await db.query(
        `insert into chunks (collection_id, id, doc_id, ord, page, words, text, embedding) values ${rows.join(', ')}
         on conflict (collection_id, id) do update set text = excluded.text, embedding = excluded.embedding`,
        params,
      );
      progress.set(key, { done: Math.min(i + BATCH, chunks.length), total: chunks.length });
    }
    await addSpend(db, cost);
    await setDoc(db, collectionId, doc.id, { status: 'ready', chunks: chunks.length, error: null });
    log.info?.({ collectionId, doc: doc.id, chunks: chunks.length, words, cost }, 'ingested');
  } catch (e) {
    log.error?.({ err: e.message, collectionId, doc: doc.id }, 'ingest failed');
    await db.query('delete from chunks where collection_id = $1 and doc_id = $2', [collectionId, doc.id]).catch(() => {});
    await setDoc(db, collectionId, doc.id, { status: 'error', error: e.user || e.status === 415 ? e.message : `Processing failed: ${e.message}` }).catch(() => {});
  } finally {
    progress.delete(key);
  }
}
