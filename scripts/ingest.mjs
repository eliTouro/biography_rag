// Create a collection and ingest files into it, straight against the database in DATABASE_URL.
// usage: node --env-file=.env scripts/ingest.mjs --person "Benjamin Franklin" [--aliases "Ben Franklin"] [--collection <id>] file1.txt file2.pdf ...
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { openDb } from '../src/db.js';
import { makeLlm } from '../src/llm.js';
import { ingestDocument } from '../src/ingest.js';
import { parseArgs, newId, saveOwnerToken, getCollection } from './_common.mjs';

const { flags, rest: files } = parseArgs(process.argv.slice(2));
if (!files.length || (!flags.person && !flags.collection)) {
  console.error('usage: ingest.mjs --person "Name" [--aliases "..."] [--collection id] files...');
  process.exit(1);
}
const db = await openDb();
const llm = makeLlm();
let c;
if (flags.collection) c = await getCollection(db, flags.collection);
else {
  const id = newId('c');
  const token = crypto.randomBytes(24).toString('base64url');
  await db.query('insert into collections (id, person, aliases, owner_hash) values ($1,$2,$3,$4)', [id, flags.person, flags.aliases || '', crypto.createHash('sha256').update(token).digest('hex')]);
  saveOwnerToken(id, token);
  c = await getCollection(db, id);
  console.log(`created collection ${id} for ${c.person} (owner token saved in .owner-tokens.json)`);
}
let seq = Number((await db.query('select coalesce(max(seq),0)::int as m from documents where collection_id=$1', [c.id])).rows[0].m);
for (const f of files) {
  seq++;
  const buf = fs.readFileSync(f);
  const doc = { id: `D${String(seq).padStart(2, '0')}`, seq, filename: path.basename(f), bytes: buf.length };
  await db.query('insert into documents (collection_id, id, seq, filename, bytes) values ($1,$2,$3,$4,$5)', [c.id, doc.id, seq, doc.filename, doc.bytes]);
  const t0 = Date.now();
  await ingestDocument(db, llm, { collectionId: c.id, doc, buffer: buf, log: { info() {}, error: (o, m) => console.error(m, o) } });
  const d = (await db.query('select * from documents where collection_id=$1 and id=$2', [c.id, doc.id])).rows[0];
  console.log(`${doc.id} ${doc.filename}: ${d.status} ${d.words} words, ~${d.est_pages} pages, ${d.chunks} chunks (${((Date.now() - t0) / 1000).toFixed(1)}s)${d.error ? ' ERROR ' + d.error : ''}`);
}
const tot = (await db.query('select count(*)::int n, coalesce(sum(est_pages),0)::int p from documents where collection_id=$1', [c.id])).rows[0];
console.log(`collection ${c.id}: ${tot.n} documents, ~${tot.p} pages`);
await db.close();
