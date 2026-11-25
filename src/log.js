// Run log: every query, the chunk IDs it retrieved, the exact prompt sent and the reply.

export class RunLog {
  constructor(db, runId) { this.db = db; this.runId = runId; this.seq = 0; this.chain = Promise.resolve(); }
  add({ step, query = null, retrieved = null, prompt = null, response = null, usage = null }) {
    const seq = ++this.seq;
    // Serialize inserts so seq order matches insertion order even with parallel questions.
    this.chain = this.chain.then(() => this.db.query(
      `insert into run_log (run_id, seq, step, query, retrieved, prompt, response, usage) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [this.runId, seq, step, query, j(retrieved), j(prompt), j(response), j(usage)],
    ));
    return this.chain;
  }
}
const j = (x) => (x == null ? null : JSON.stringify(x));

export async function getLog(db, runId) {
  const rows = (await db.query('select seq, step, query, retrieved, prompt, response, usage, created_at from run_log where run_id = $1 order by seq', [runId])).rows;
  return rows.map((r) => ({ seq: r.seq, step: r.step, query: r.query, retrieved: r.retrieved, prompt: r.prompt, response: r.response, usage: r.usage, createdAt: r.created_at }));
}

const fence = (s) => '```text\n' + String(s ?? '').replace(/```/g, "'''") + '\n```';

export function logToMarkdown(run, entries) {
  const out = [];
  out.push(`# Run log: ${run.kind === 'story' ? 'story' : 'question'} for ${run.person}`);
  out.push('');
  out.push(`- Run: \`${run.id}\`, collection \`${run.collectionId}\``);
  out.push(`- Started ${new Date(run.createdAt).toISOString()}, status ${run.status}, estimated cost $${Number(run.costUsd || 0).toFixed(4)}`);
  out.push(`- ${entries.length} logged steps. Each step lists the query, the chunk IDs retrieved (rank in vector search, rank in keyword search, fused score), the exact prompt sent, and the model's reply.`);
  out.push('');
  for (const e of entries) {
    out.push(`## ${e.seq}. ${e.step}: ${e.query ?? ''}`);
    out.push('');
    if (e.retrieved?.length) {
      if ('rrf' in e.retrieved[0]) {
        out.push('| chunk | vector rank | keyword rank | fused (RRF) | cosine |');
        out.push('|---|---|---|---|---|');
        for (const h of e.retrieved) out.push(`| ${h.id} | ${h.vecRank ?? '-'} | ${h.ftsRank ?? '-'} | ${h.rrf} | ${h.vecScore ?? '-'} |`);
      } else {
        out.push(`Chunks: ${e.retrieved.map((h) => h.id).join(', ')}`);
      }
      out.push('');
    } else if (e.step === 'extract' || e.step === 'ask') {
      out.push('Retrieved: nothing.');
      out.push('');
    }
    if (e.prompt) {
      if (e.prompt.tsQuery !== undefined) out.push(`Keyword query: \`${e.prompt.tsQuery || '(empty)'}\``, '');
      out.push(`<details><summary>Prompt sent to ${e.prompt.model}</summary>`, '', '**System**', '', fence(e.prompt.system), '', '**User**', '', fence(e.prompt.user), '', '</details>', '');
    }
    if (e.response) {
      out.push('**Reply**', '', '```json', JSON.stringify(e.response, null, 2), '```', '');
    }
    if (e.usage) out.push(`Tokens: ${e.usage.input} in, ${e.usage.output} out`, '');
  }
  return out.join('\n');
}

const cite = (ids) => (ids.length ? ' ' + ids.map((id) => `[${id}]`).join('') : '');

const FLAG_TEXT = {
  'no-citation': 'no source cited',
  'unknown-citation': 'cites a chunk that wasn\'t retrieved for a fact',
  'judge-partly': 'source only partly supports this',
  'judge-no': 'source doesn\'t support this',
  'new-terms': 'has names or numbers the cited chunks do not contain',
};

export function storyToMarkdown(run, documents = []) {
  const r = run.result;
  const out = [];
  out.push(`# ${r.story.title}`);
  out.push('');
  out.push(`*A story of ${r.person} written only from retrieved snippets. Every sentence ends with the chunk IDs it came from. Sentences marked ⚠ were flagged by the verifier.*`);
  out.push('');
  for (const s of r.story.sections) {
    out.push(`## ${s.heading}`);
    out.push('');
    out.push(s.sentences.map((x) => `${x.flags?.length ? '⚠ ' : ''}${x.text}${cite(x.chunkIds)}`).join(' '));
    out.push('');
  }
  if (r.notInSources.length) {
    out.push('## Not in the sources');
    out.push('');
    for (const n of r.notInSources) {
      const q = r.questions.find((x) => x.n === n);
      out.push(`- Q${n}. ${q.question}: not in the sources.`);
    }
    out.push('');
  }
  const flagged = r.story.sections.flatMap((s) => s.sentences).filter((x) => x.flags?.length);
  out.push('## Verification');
  out.push('');
  out.push(`${r.review.sentences} sentences, ${r.review.cited} with citations, ${r.review.flagged} flagged. ${r.review.coverage.found} of ${r.review.coverage.total} questions answered from the sources. ${r.review.rejectedFacts ?? 0} extracted facts were dropped because their quote wasn't found in the cited chunk.`);
  out.push('');
  if (flagged.length) {
    for (const x of flagged) out.push(`- ⚠ "${x.text}": ${x.flags.map((f) => FLAG_TEXT[f] || f).join('; ')}${x.note ? `. Unsupported: ${x.note}` : ''}`);
    out.push('');
  }
  out.push('## The 20 questions');
  out.push('');
  out.push('| # | Question | Answer from the sources | Chunks retrieved |');
  out.push('|---|---|---|---|');
  for (const q of r.questions) {
    const ans = q.found ? q.answer + cite([...new Set(q.facts.flatMap((f) => f.chunkIds))]) : 'Not in the sources.';
    out.push(`| ${q.n} | ${q.question} | ${ans.replace(/\|/g, '\\|').replace(/\n/g, ' ')} | ${q.retrieved.map((h) => h.id).join(', ')} |`);
  }
  out.push('');
  if (documents.length) {
    out.push('## Sources in this collection');
    out.push('');
    for (const d of documents) out.push(`- ${d.id}: ${d.filename} (${d.words.toLocaleString()} words, about ${d.estPages} pages, ${d.chunks} chunks)`);
    out.push('');
  }
  return out.join('\n');
}
