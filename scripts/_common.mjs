import crypto from 'node:crypto';
import fs from 'node:fs';

export function parseArgs(argv) {
  const flags = {};
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) { flags[a.slice(2)] = argv[i + 1]; i++; } else rest.push(a);
  }
  return { flags, rest };
}

export const newId = (prefix) => `${prefix}${crypto.randomBytes(6).toString('base64url').replace(/[-_]/g, '').slice(0, 8).toLowerCase()}`;

const TOKENS = new URL('../.owner-tokens.json', import.meta.url);
export function saveOwnerToken(id, token) {
  const all = fs.existsSync(TOKENS) ? JSON.parse(fs.readFileSync(TOKENS, 'utf8')) : {};
  all[id] = token;
  fs.writeFileSync(TOKENS, JSON.stringify(all, null, 2));
}

export async function getCollection(db, id) {
  const c = (await db.query('select * from collections where id = $1', [id])).rows[0];
  if (!c) throw new Error(`No collection ${id}`);
  return c;
}

export function runRow(r) {
  return { id: r.id, collectionId: r.collection_id, kind: r.kind, question: r.question, status: r.status, costUsd: Number(r.cost_usd), createdAt: r.created_at, result: r.result, person: r.person };
}
