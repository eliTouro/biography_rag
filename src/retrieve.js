// Hybrid retrieval: exact pgvector cosine + Postgres full-text, fused with reciprocal-rank fusion.
import { cfg } from './config.js';
import { toVectorLiteral } from './db.js';

const STOPWORDS = new Set(`a about above after again against all also am an and any are as at be because been before being below
between both but by can could did do does doing down during each few for from further had has have having he her here hers
herself him himself his how i if in into is it its itself just me more most my myself no nor not now of off on once only or
other our ours ourselves out over own same she should so some such than that the their theirs them themselves then there these
they this those through to too under until up very was we were what when where which while who whom why will with would you
your yours yourself yourselves thing things something someone time times like life story moment person`.split(/\s+/));

export function buildTsQuery(text, excludeWords = []) {
  const exclude = new Set(excludeWords.map((w) => String(w).toLowerCase()));
  const seen = new Set();
  const out = [];
  for (const w of String(text ?? '').toLowerCase().match(/[a-z]+/g) || []) {
    if (w.length < 3 || STOPWORDS.has(w) || exclude.has(w) || seen.has(w)) continue;
    seen.add(w);
    out.push(w);
  }
  return out.join(' | ');
}

export function rrfMerge(vecList, ftsList, k = 8, c = 60) {
  const map = new Map();
  const add = (list, key) => list.forEach((id, i) => {
    const e = map.get(id) || { id, rrf: 0, vecRank: null, ftsRank: null };
    e[key] = i + 1;
    e.rrf += 1 / (c + i + 1);
    map.set(id, e);
  });
  add(vecList || [], 'vecRank');
  add(ftsList || [], 'ftsRank');
  return [...map.values()]
    .sort((a, b) => b.rrf - a.rrf || (a.vecRank ?? Infinity) - (b.vecRank ?? Infinity))
    .slice(0, k)
    .map((e) => ({ ...e, rrf: Number(e.rrf.toFixed(6)) }));
}

/** Words of the person's name and aliases: they appear in nearly every chunk, so they only add noise to keyword search. */
export function nameWords(person, aliases = '') {
  return `${person} ${aliases}`.toLowerCase().match(/[a-z]+/g) || [];
}

/**
 * @returns {Promise<{hits, chunks, embedUsage}>}
 */
export async function retrieve(db, llm, { collectionId, question, hints = '', exclude = [], k = cfg.topK }) {
  const { vectors, usage } = await llm.embed([question]);
  const vec = toVectorLiteral(vectors[0]);
  const n = cfg.candidatesPerList;
  const vecRows = (await db.query(
    `select id, 1 - (embedding <=> $2::vector) as score from chunks
      where collection_id = $1 and embedding is not null
      order by embedding <=> $2::vector limit ${n}`,
    [collectionId, vec],
  )).rows;
  const tsq = buildTsQuery(`${question} ${hints}`, exclude);
  let ftsRows = [];
  if (tsq) {
    ftsRows = (await db.query(
      `select id, ts_rank_cd(tsv, q, 1) as score
         from chunks, to_tsquery('english', $2) q
        where collection_id = $1 and tsv @@ q
        order by score desc, id limit ${n}`,
      [collectionId, tsq],
    )).rows;
  }
  const hits = rrfMerge(vecRows.map((r) => r.id), ftsRows.map((r) => r.id), k);
  const vecScore = new Map(vecRows.map((r) => [r.id, Number(r.score)]));
  const ftsScore = new Map(ftsRows.map((r) => [r.id, Number(r.score)]));
  for (const h of hits) {
    h.vecScore = vecScore.has(h.id) ? Number(vecScore.get(h.id).toFixed(4)) : null;
    h.ftsScore = ftsScore.has(h.id) ? Number(ftsScore.get(h.id).toFixed(4)) : null;
  }
  const chunks = await loadChunks(db, collectionId, hits.map((h) => h.id));
  return { hits, chunks, tsQuery: tsq, embedUsage: usage };
}

export async function loadChunks(db, collectionId, ids) {
  if (!ids.length) return {};
  const rows = (await db.query(
    `select c.id, c.doc_id, c.page, c.text, d.filename from chunks c
       join documents d on d.collection_id = c.collection_id and d.id = c.doc_id
      where c.collection_id = $1 and c.id = any($2::text[])`,
    [collectionId, ids],
  )).rows;
  const out = {};
  for (const r of rows) out[r.id] = { id: r.id, docId: r.doc_id, filename: r.filename, page: r.page ?? null, text: r.text };
  return out;
}
