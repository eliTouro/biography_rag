// All tunables in one place. Read once at import time.
const num = (v, d) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? d : Number(v));

export const cfg = {
  port: num(process.env.PORT, 3000),
  databaseUrl: process.env.DATABASE_URL || '',
  provider: process.env.LLM_PROVIDER || (process.env.OPENAI_API_KEY ? 'openai' : 'mock'),
  chatModel: process.env.CHAT_MODEL || 'gpt-5.4-mini',
  judgeModel: process.env.JUDGE_MODEL || process.env.CHAT_MODEL || 'gpt-5.4-mini',
  embedModel: process.env.EMBED_MODEL || 'text-embedding-3-small',
  embedDims: 1536,
  topK: num(process.env.TOP_K, 8),
  candidatesPerList: 20,
  queryConcurrency: num(process.env.QUERY_CONCURRENCY, 5),
  dailyBudgetUsd: num(process.env.DAILY_BUDGET_USD, 3),
  maxFileBytes: 60 * 1024 * 1024,
  maxRequestBytes: 80 * 1024 * 1024,
  maxFiles: 40,
  maxChunksPerCollection: num(process.env.MAX_CHUNKS, 8000),
  wordsPerPage: 275,
  // USD per 1M tokens. Estimates; override with env if the price sheet changes.
  prices: {
    embed: num(process.env.PRICE_EMBED, 0.02),
    chatIn: num(process.env.PRICE_CHAT_IN, 0.75),
    chatOut: num(process.env.PRICE_CHAT_OUT, 4.5),
  },
  // Simple per-IP limits for a public site that spends the owner's API credit.
  limits: {
    storyRunsPerHour: num(process.env.LIMIT_RUNS_PER_HOUR, 6),
    asksPerHour: num(process.env.LIMIT_ASKS_PER_HOUR, 40),
    uploadsPerHour: num(process.env.LIMIT_UPLOADS_PER_HOUR, 30),
    collectionsPerHour: num(process.env.LIMIT_COLLECTIONS_PER_HOUR, 10),
  },
};
