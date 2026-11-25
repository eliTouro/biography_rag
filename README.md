# Biography RAG

Upload a pile of pages about one person, and the app writes that person's story **only from snippets it retrieves from those pages**. Every sentence carries the IDs of the chunks it came from. A verifier flags anything the sources don't support, which means it probably came from the model's own training data.

- **Live site:** https://biography-rag-8zrd.onrender.com/
- **Sample output (Benjamin Franklin, about 1,000 pages):** [`samples/franklin/story.md`](samples/franklin/story.md), logs in [`samples/franklin/log.md`](samples/franklin/log.md), and my review of the logs in [`samples/franklin/REVIEW.md`](samples/franklin/REVIEW.md)
- **Write-up:** [`WRITEUP.md`](WRITEUP.md)

## How it works

```
upload (.txt .md .html .pdf .docx)
  → extract text → strip Project Gutenberg boilerplate, unwrap lines, drop index pages
  → chunk (~260 words, paragraph-aware, 45-word sentence overlap) → IDs like D02-C0147
  → embed (OpenAI text-embedding-3-small) → Postgres + pgvector (Neon)

"Write the story"
  for each of the 20 questions ({person} filled in):
    hybrid retrieval: pgvector cosine top-20 + Postgres full-text top-20 → reciprocal-rank fusion → top 8
    extraction call: the model sees ONLY those 8 snippets and returns {found, facts[{fact, chunk_ids, quote}]}
    quote check: each fact's quote must appear in a cited chunk, or the fact is dropped
    nothing left → "Not in the sources." and the story skips it
  weave call: the story is written only from the surviving facts, one sentence at a time, each with chunk IDs
  verify: deterministic checks (every sentence cited, citations point at real retrieved facts)
          + an LLM judge that sees only the cited chunk text → yes / partly / no per sentence
  everything is logged: query, chunk IDs retrieved (with ranks), exact prompt, reply, tokens
```

"Ask your own question" runs the same retrieve → extract → quote-check path for one free question. It's what the canary test uses: a question that's true about the person but not in the corpus should come back "Not in the sources."

## Run it locally

Node 22 or newer.

```bash
npm install
cp .env.example .env              # fill in DATABASE_URL and OPENAI_API_KEY
npm run dev                       # http://localhost:3000
```

Free mode, with no keys and no database: `LLM_PROVIDER=mock npm run dev:mock` uses an in-memory PGlite and a deterministic fake model.

```bash
npm test                          # unit tests + full end-to-end flow on the mock model
npm run ingest -- --person "Benjamin Franklin" --aliases "Ben Franklin" corpus/franklin/*.txt
npm run story -- <collectionId> --out samples/franklin
npm run ask -- <collectionId> "On which banknote does Franklin's portrait appear?" --out samples/franklin/canary.md
```

## Deploy (Render + Neon)

`render.yaml` is a Render Blueprint (free web service, health check `/healthz`). Set `OPENAI_API_KEY` and `DATABASE_URL` (a Neon Postgres URL; the schema, including `create extension vector`, is applied on start). Keys live only in Render's environment and in a local `.env`, which is git-ignored.

## Guardrails (it's a public site on my API key)

- Uploads: 60 MB per file, 80 MB per request, 40 files, 8,000 chunks per collection.
- Only the browser that created a collection (it holds an owner token) can add files or delete it. Anyone can write a story or ask a question.
- Per-IP hourly limits, at most 2 story runs at once, and a daily spend cap (`DAILY_BUDGET_USD`, default $3, estimated from token usage).

## Project layout

| Path | What |
|---|---|
| `server.js` | starts the app, connects the DB, marks interrupted runs as failed |
| `src/app.js` | HTTP API (see `docs/CONTRACT.md`) and the static frontend |
| `src/extract.js`, `src/clean.js`, `src/chunk.js` | file → text → paragraphs → chunks |
| `src/ingest.js` | background ingestion queue: chunk, embed, store, progress |
| `src/retrieve.js` | hybrid vector + keyword retrieval with reciprocal-rank fusion |
| `src/queries.js` | the 20 questions and their generic keyword hints |
| `src/generate.js` | prompts, extraction, story weaving, the LLM judge, "ask" |
| `src/verify.js` | quote matching, citation checks, sentence splitting |
| `src/log.js` | run log storage and Markdown exports for logs and stories |
| `src/llm.js` | OpenAI provider and the free mock provider |
| `src/budget.js` | daily spend cap and rate limits |
| `db/schema.sql` | Postgres + pgvector schema |
| `public/` | single-page frontend (`index.html`, `app.js`, demo fixtures at `?demo=1`) |
| `scripts/` | CLI: ingest, story, ask |
| `corpus/franklin/` | the test corpus (public-domain biographies from Project Gutenberg) |
| `samples/franklin/` | the generated story, logs, canary test and review |
| `test/` | `node:test` suite |
