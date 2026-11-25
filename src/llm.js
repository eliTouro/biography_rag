// LLM + embedding provider. `openai` for real runs, `mock` for free deterministic tests.
import { cfg } from './config.js';
import { normalizeForMatch, splitSentences } from './verify.js';

const STOP = new Set('a an and are as at be been but by did do does for from had has have he her his how i in into is it its of on or she so than that the their them then there they this to was were what when where which who whom why will with would you your about after also any before can could each more most other our out over own some such up very'.split(' '));

export const contentWords = (s) => normalizeForMatch(s).split(' ').filter((w) => w.length >= 3 && !STOP.has(w));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function withRetry(fn, tries = 5) {
  let delay = 1500;
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      const status = e?.status ?? e?.response?.status;
      const kind = e?.constructor?.name || e?.name || '';
      const netMsg = `${e?.message || ''} ${e?.cause?.message || ''} ${e?.cause?.cause?.code || ''}`;
      const retriable = status === 429 || status >= 500 || /APIConnection(Timeout)?Error/.test(kind) || /ECONNRESET|ETIMEDOUT|EAI_AGAIN|fetch failed|Connection error|socket hang up/i.test(netMsg);
      if (!retriable || i >= tries - 1) throw e;
      await sleep(delay + Math.random() * 500);
      delay *= 2;
    }
  }
}

function openaiLlm() {
  let clientP;
  const client = async () => {
    if (!clientP) clientP = import('openai').then(({ default: OpenAI }) => new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 120_000, maxRetries: 0 }));
    return clientP;
  };
  return {
    provider: 'openai',
    chatModel: cfg.chatModel,
    embedModel: cfg.embedModel,
    async embed(texts) {
      const c = await client();
      const res = await withRetry(() => c.embeddings.create({ model: cfg.embedModel, input: texts }));
      return { vectors: res.data.sort((a, b) => a.index - b.index).map((d) => d.embedding), usage: { input: res.usage?.prompt_tokens ?? 0, output: 0 } };
    },
    /** JSON-schema-constrained chat call. Returns {data, raw, usage, model}. */
    async chatJson({ system, user, schemaName, schema, model = cfg.chatModel }) {
      const c = await client();
      const body = {
        model,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        response_format: { type: 'json_schema', json_schema: { name: schemaName, strict: true, schema } },
      };
      if (/^(gpt-5|o\d)/.test(model)) body.reasoning_effort = 'low';
      else body.temperature = 0;
      const res = await withRetry(() => c.chat.completions.create(body));
      const raw = res.choices?.[0]?.message?.content ?? '';
      let data;
      try { data = JSON.parse(raw); } catch { throw new Error(`Model returned invalid JSON for ${schemaName}`); }
      return { data, raw, model: res.model, usage: { input: res.usage?.prompt_tokens ?? 0, output: res.usage?.completion_tokens ?? 0 } };
    },
  };
}

// ---------- mock ----------
function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
const stem = (w) => w.replace(/(ings?|ed|es|s)$/, '') || w;

function mockEmbed(text) {
  const v = new Float32Array(cfg.embedDims);
  for (const w of contentWords(text)) v[hash(stem(w)) % cfg.embedDims] += 1;
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  return Array.from(v, (x) => x / n);
}

// Parse the snippet block the generator builds: lines "[D01-C0003] (from ...)" followed by text.
function parseSnippets(user) {
  const out = [];
  const re = /^\[(D\d+-C\d+)\][^\n]*\n([\s\S]*?)(?=^\[D\d+-C\d+\]|^=====|(?![\s\S]))/gm;
  let m;
  while ((m = re.exec(user))) out.push({ id: m[1], text: m[2].trim() });
  return out;
}

function mockChat({ user, schemaName }) {
  if (schemaName === 'extraction') {
    const q = /^Question: (.*)$/m.exec(user)?.[1] ?? '';
    const person = /^Person: (.*)$/m.exec(user)?.[1] ?? '';
    const nameWords = new Set(contentWords(person));
    const qWords = new Set(contentWords(q).filter((w) => !nameWords.has(w)).map(stem));
    let best = null;
    for (const sn of parseSnippets(user)) {
      for (const s of splitSentences(sn.text)) {
        const hits = contentWords(s).filter((w) => qWords.has(stem(w))).length;
        if (hits > 0 && (!best || hits > best.hits)) best = { hits, id: sn.id, s };
      }
    }
    if (!best) return { found: false, answer: '', facts: [] };
    const quote = best.s.split(/\s+/).slice(0, 25).join(' ');
    return { found: true, answer: best.s, facts: [{ fact: best.s, chunk_ids: [best.id], quote }] };
  }
  if (schemaName === 'story') {
    const facts = [...user.matchAll(/^F\d+ \[([^\]]*)\][^\n]*?:: (.*)$/gm)].map((m) => ({ ids: m[1].split(',').map((x) => x.trim()).filter(Boolean), text: m[2] }));
    const sentences = facts.map((f) => ({ text: f.text, chunk_ids: f.ids }));
    return { title: 'A life from the sources', sections: [{ heading: 'The story', sentences }] };
  }
  if (schemaName === 'judge') {
    const ns = [...user.matchAll(/^S(\d+):/gm)].map((m) => Number(m[1]));
    return { verdicts: ns.map((n) => ({ sentence: n, support: 'yes', unsupported: '' })) };
  }
  throw new Error(`mock: unknown schema ${schemaName}`);
}

function mockLlm() {
  return {
    provider: 'mock',
    chatModel: 'mock-chat',
    embedModel: 'mock-embed',
    async embed(texts) {
      return { vectors: texts.map(mockEmbed), usage: { input: 0, output: 0 } };
    },
    async chatJson(args) {
      const data = mockChat(args);
      return { data, raw: JSON.stringify(data), model: 'mock-chat', usage: { input: 0, output: 0 } };
    },
  };
}

export function makeLlm(provider = cfg.provider) {
  if (provider === 'mock') return mockLlm();
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not set (or use LLM_PROVIDER=mock)');
  return openaiLlm();
}

export function costOf(usage, kind) {
  if (!usage) return 0;
  if (kind === 'embed') return (usage.input * cfg.prices.embed) / 1e6;
  return (usage.input * cfg.prices.chatIn + usage.output * cfg.prices.chatOut) / 1e6;
}
