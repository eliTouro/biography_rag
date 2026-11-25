// Daily API spend cap (estimated from token usage) and simple per-IP rate limits.
import { cfg } from './config.js';

const today = () => new Date().toISOString().slice(0, 10);

export class LimitError extends Error {
  constructor(msg) { super(msg); this.status = 429; }
}

export async function addSpend(db, usd) {
  if (!usd) return;
  await db.query(
    `insert into spend(day, usd) values ($1, $2)
     on conflict (day) do update set usd = spend.usd + excluded.usd`,
    [today(), usd],
  );
}

export async function spentToday(db) {
  const r = await db.query('select usd from spend where day = $1', [today()]);
  return r.rows[0] ? Number(r.rows[0].usd) : 0;
}

export async function assertBudget(db) {
  const spent = await spentToday(db);
  if (spent >= cfg.dailyBudgetUsd) {
    throw new LimitError(`Today's API budget for this demo site is used up ($${cfg.dailyBudgetUsd}). Try again tomorrow (UTC).`);
  }
}

const buckets = new Map();
export function rateLimit(kind, ip, perHour) {
  const key = `${kind}:${ip}`;
  const now = Date.now();
  const arr = (buckets.get(key) || []).filter((t) => now - t < 3600_000);
  if (arr.length >= perHour) {
    const waitMin = Math.ceil((3600_000 - (now - arr[0])) / 60_000);
    throw new LimitError(`Too many requests of this kind from your network. Try again in about ${waitMin} min.`);
  }
  arr.push(now);
  buckets.set(key, arr);
}
