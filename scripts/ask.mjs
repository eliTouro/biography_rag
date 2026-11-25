// Ask one question against a collection (the canary test). Appends the answer and its full log to a file.
// usage: node --env-file=.env scripts/ask.mjs <collectionId> "question" [--out samples/franklin/canary.md]
import fs from 'node:fs';
import { openDb } from '../src/db.js';
import { makeLlm } from '../src/llm.js';
import { runAsk } from '../src/generate.js';
import { getLog, logToMarkdown } from '../src/log.js';
import { parseArgs, newId, getCollection, runRow } from './_common.mjs';

const { flags, rest } = parseArgs(process.argv.slice(2));
const db = await openDb();
const llm = makeLlm();
const c = await getCollection(db, rest[0]);
const question = rest[1];
const runId = newId('q');
await db.query(`insert into runs (id, collection_id, kind, question, status) values ($1,$2,'ask',$3,'running')`, [runId, c.id, question]);
const res = await runAsk({ db, llm, collection: c, runId, question });
console.log(`Q: ${question}\nA: ${res.answer}\nfound=${res.found} facts=${res.facts.length} rejected=${res.rejected.length} retrieved=${res.retrieved.map((h) => h.id).join(',')}`);
if (flags.out) {
  const r = runRow((await db.query('select r.*, c.person from runs r join collections c on c.id=r.collection_id where r.id=$1', [runId])).rows[0]);
  const entries = await getLog(db, runId);
  const cites = [...new Set(res.facts.flatMap((f) => f.chunkIds))].map((id) => `[${id}]`).join('');
  const block = [`## Q: ${question}`, '', `**Answer:** ${res.answer}${cites ? ' ' + cites : ''}`, '', `Run \`${runId}\`. Retrieved: ${res.retrieved.map((h) => h.id).join(', ')}.`, '', logToMarkdown(r, entries).split('\n').slice(4).join('\n'), ''].join('\n');
  fs.appendFileSync(flags.out, block + '\n');
}
await db.close();
