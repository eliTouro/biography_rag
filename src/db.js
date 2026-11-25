// Postgres (Neon) when DATABASE_URL is set; otherwise an in-memory PGlite with pgvector
// so tests and mock mode need nothing installed.
import fs from 'node:fs';
import { cfg } from './config.js';

const schemaSql = () => fs.readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8');

export async function openDb(url = cfg.databaseUrl) {
  let db;
  if (url) {
    const pg = (await import('pg')).default;
    const pool = new pg.Pool({ connectionString: url, max: 6, idleTimeoutMillis: 30_000 });
    pool.on('error', (e) => console.error('pg pool error', e.message));
    db = {
      kind: 'postgres',
      query: (text, params) => pool.query(text, params),
      exec: (text) => pool.query(text),
      close: () => pool.end(),
    };
  } else {
    const { PGlite } = await import('@electric-sql/pglite');
    const { vector } = await import('@electric-sql/pglite-pgvector');
    const lite = await PGlite.create({ extensions: { vector } });
    db = {
      kind: 'pglite',
      query: (text, params) => lite.query(text, params),
      exec: (text) => lite.exec(text),
      close: () => lite.close(),
    };
  }
  await db.exec(schemaSql());
  return db;
}

export const toVectorLiteral = (v) => '[' + Array.from(v, (x) => (Number.isFinite(x) ? x.toFixed(6) : '0')).join(',') + ']';
