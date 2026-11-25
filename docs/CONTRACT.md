# Interfaces (the contract the server, frontend and tests share)

## HTTP API (JSON unless noted)

| Method + path | Body / headers | Returns |
|---|---|---|
| `GET /healthz` | none | `{ok:true, provider:"openai"\|"mock", db:"postgres"\|"pglite", chatModel, embedModel}` |
| `GET /api/collections` | none | `{collections:[{id, person, aliases, documents, chunks, words, estPages, createdAt}]}` (newest first, max 30) |
| `POST /api/collections` | `{person, aliases?}` | `201 {id, person, aliases, ownerToken}`. The client keeps `ownerToken` (localStorage `brag.owner.<id>`). |
| `GET /api/collections/:id` | none | `{collection:{id, person, aliases, createdAt}, documents:[Doc], totals:{documents, chunks, words, estPages}, runs:[RunSummary]}` |
| `POST /api/collections/:id/files` | multipart, field `files` (1 to 40 files, max 60 MB each, 80 MB per request), header `X-Owner-Token` | `202 {documents:[Doc]}`. Processing continues in the background, so poll `GET /api/collections/:id`. |
| `DELETE /api/collections/:id` | header `X-Owner-Token` | `204` |
| `POST /api/collections/:id/runs` | `{}` | `202 {runId}`. Starts the 20-question story run. |
| `POST /api/collections/:id/ask` | `{question}` | `200 {runId, result:AskResult}` (synchronous, ~5 to 15 s) |
| `GET /api/runs/:id` | none | `{run:{id, collectionId, kind:"story"\|"ask", question, status:"running"\|"done"\|"error", progress, result, costUsd, error, createdAt, finishedAt}}` |
| `GET /api/runs/:id/log.json` | none | download: `{run, entries:[LogEntry]}` |
| `GET /api/runs/:id/log.md` | none | download, Markdown |
| `GET /api/runs/:id/story.md` | none | download, Markdown |
| `GET /api/collections/:id/chunks/:chunkId` | none | `{chunk:{id, docId, filename, page, text}}` |

Errors look like `{error:"human-readable message"}` with a 4xx/5xx status: 400 bad input, 403 wrong or missing owner token, 404, 413 too large, 415 unsupported file type, 429 rate limit or daily budget reached.

### Shapes
- `Doc` = `{id:"D01", seq:1, filename, bytes, words, estPages, chunks, status:"queued"|"extracting"|"embedding"|"ready"|"error", error|null, progress:{done, total}|null}`
- `RunSummary` = `{id, kind, question, status, createdAt, costUsd}`
- Story run `progress` = `{stage:"retrieving"|"weaving"|"verifying"|"done", questionsDone, questionsTotal:20}`
- Story run `result` (a `StoryResult`):
```
{
  person,
  questions: [{ n, question, topic, found, answer,        // answer = "Not in the sources." when found=false
                facts:[{fact, chunkIds:[..], quote, quoteCheck:"exact"|"close"}],
                rejected:[{fact, chunkIds, quote, reason}],
                retrieved:[{id, rrf, vecRank, ftsRank}] }],
  story: { title, sections:[{ heading, sentences:[{ text, chunkIds:[..],
             support:"yes"|"partly"|"no", flags:[string], note }] }] },
  notInSources: [n, ...],                                 // question numbers the story skipped
  review: { sentences, cited, flagged, unsupported, coverage:{found, total:20} },
  chunks: { "<chunkId>": {id, docId, filename, page, text} }   // every chunk retrieved in this run
}
```
- Sentence `flags` values: `"no-citation"`, `"unknown-citation"` (cites an ID that wasn't retrieved), `"judge-partly"`, `"judge-no"`. A sentence with any flag counts as flagged, meaning it may come from the model's training data.
- `AskResult` = `{question, found, answer, facts:[...same as above], rejected:[...], retrieved:[...], chunks:{...}}`
- `LogEntry` = `{seq, step:"embed-query"|"retrieve"|"extract"|"weave"|"judge"|"ask", query, retrieved:[{id, rrf, vecRank, ftsRank}]|null, prompt:{model, system, user}|null, response, usage:{input, output}|null, createdAt}`

Chunk IDs look like `D02-C0147`: document 2 of the collection, chunk 147 (0-based) of that document.

## Pure modules (ES modules, `"type":"module"`)

- `src/clean.js`
  - `stripGutenberg(text) -> string`: drops everything up to and including the `*** START OF THE/THIS PROJECT GUTENBERG ...` line, and from the `*** END OF ...` line on. Returns the input unchanged when there are no markers.
  - `toParagraphs(text, {pdf=false}={}) -> string[]`: normalizes `\r\n`, removes soft hyphens and `_italic_` underscores, and, only when `pdf`, joins `word-\nword`. Splits on blank lines, collapses inner whitespace to single spaces, and drops empty paragraphs and index-like paragraphs (more than 15 words where at least 30% of tokens are numbers).
- `src/chunk.js`
  - `chunkParagraphs(paragraphs, {target=260, max=380, overlap=45}={}) -> [{text, words}]`: greedy, paragraph-aware. Paragraphs over `max` words are split at sentence ends. Every chunk has at most `max + overlap` words. Each chunk after the first starts with up to `overlap` words of whole sentences from the end of the previous one. All input text appears in some chunk, and empty input returns `[]`.
  - `countWords(s) -> number`
  - `chunkId(docSeq, ord) -> string`: `chunkId(2,147) === "D02-C0147"`
- `src/retrieve.js`
  - `rrfMerge(vecList, ftsList, k=8, c=60) -> [{id, rrf, vecRank, ftsRank}]`: each list is IDs in rank order. Ranks are 1-based, `null` when absent. `rrf = Σ 1/(c+rank)`. Sorted by rrf descending, ties broken by better vecRank, length ≤ k.
  - `buildTsQuery(text, excludeWords=[]) -> string`: lowercase `[a-z]+` words of length ≥ 3, minus English stopwords and minus `excludeWords` (lowercased), deduped, joined with `" | "`. Returns `""` when nothing is left.
  - `retrieve(db, llm, {collectionId, question, hints, exclude, k}) -> {hits:[{id, rrf, vecRank, ftsRank, vecScore, ftsScore}], chunks:{id:{...}}, tsQuery, embedUsage}`: async, uses the DB.
- `src/verify.js`
  - `normalizeForMatch(s) -> string`: lowercases, maps curly quotes and dashes to plain ones, strips other punctuation, collapses whitespace.
  - `checkQuote(quote, chunkText) -> "exact"|"close"|"missing"`: `exact` when the normalized quote is a substring of the normalized chunk. `close` when at least 80% of the quote's words (length ≥ 3) appear in the chunk. Otherwise `missing`. An empty quote is `missing`.
  - `screenFacts(facts, retrievedChunks) -> {kept, rejected}`: `facts` are `{fact, chunkIds, quote}`. Unknown chunk IDs are removed from `chunkIds`. A fact with no known IDs is rejected with reason `"unknown-citation"`. A fact whose quote is `missing` from every cited chunk is rejected with `"quote-not-found"`. Kept facts gain `quoteCheck`.
  - `deterministicFlags(sentence, allowedIds:Set) -> string[]`: `"no-citation"` when `chunkIds` is empty, `"unknown-citation"` when any ID is not in `allowedIds`.
  - `splitSentences(text) -> string[]`
- `src/queries.js`: `QUERIES` is an array of 20 `{n, topic, template, hints}`. `fillQuery(template, person) -> string` replaces every `{person}`.
- `src/app.js`: `createApp({db, llm}) -> express app`, `src/db.js` `openDb() -> {query(text, params) -> {rows}, kind, close()}` (PGlite when no `DATABASE_URL`), `src/llm.js` `makeLlm()` (provider from `LLM_PROVIDER`; `mock` needs no key).
