// Run the 20 questions + story for a collection and save story.md, log.md, log.json, result.json.
// usage: node --env-file=.env scripts/story.mjs <collectionId> [--out samples/franklin]
import fs from 'node:fs';
import path from 'node:path';
import { openDb } from '../src/db.js';
import { makeLlm } from '../src/llm.js';
import { runStory } from '../src/generate.js';
import { getLog, logToMarkdown, storyToMarkdown } from '../src/log.js';
import { parseArgs, newId, getCollection, runRow } from './_common.mjs';

const { flags, rest } = parseArgs(process.argv.slice(2));
const db = await openDb();
const llm = makeLlm();
const c = await getCollection(db, rest[0]);
const out = flags.out || `samples/${c.person.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
fs.mkdirSync(out, { recursive: true });
const runId = newId('r');
await db.query(`insert into runs (id, collection_id, kind, status) values ($1,$2,'story','running')`, [runId, c.id]);
const t0 = Date.now();
await runStory({ db, llm, collection: c, runId });
const r = runRow((await db.query('select r.*, c.person from runs r join collections c on c.id=r.collection_id where r.id=$1', [runId])).rows[0]);
const docs = (await db.query('select * from documents where collection_id=$1 order by seq', [c.id])).rows.map((d) => ({ id: d.id, filename: d.filename, words: d.words, estPages: d.est_pages, chunks: d.chunks }));
const entries = await getLog(db, runId);
fs.writeFileSync(path.join(out, 'story.md'), storyToMarkdown(r, docs));
fs.writeFileSync(path.join(out, 'log.md'), logToMarkdown(r, entries));
fs.writeFileSync(path.join(out, 'log.json'), JSON.stringify({ run: { ...r, result: undefined }, entries }, null, 2));
fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(r.result, null, 2));
const rv = r.result.review;
console.log(`run ${runId} done in ${((Date.now() - t0) / 1000).toFixed(0)}s, cost ~$${r.costUsd.toFixed(4)}`);
console.log(`sentences ${rv.sentences}, cited ${rv.cited}, flagged ${rv.flagged}, answered ${rv.coverage.found}/20, rejected facts ${rv.rejectedFacts}`);
console.log(`not in sources: ${r.result.notInSources.join(', ') || 'none'}`);
console.log(`wrote ${out}/story.md, log.md, log.json, result.json`);
await db.close();
