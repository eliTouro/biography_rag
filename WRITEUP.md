# Biography RAG: write-up

**Live site:** _(added after deploy)_
**Repo:** https://github.com/eliTouro/biography_rag
**The story the app generated:** [`samples/franklin/story.md`](samples/franklin/story.md)
**Logs:** [`samples/franklin/log.md`](samples/franklin/log.md) / [`log.json`](samples/franklin/log.json)
**My review of the logs:** [`samples/franklin/REVIEW.md`](samples/franklin/REVIEW.md)
**Canary test:** [`samples/franklin/canary.md`](samples/franklin/canary.md)

## What I built

A web app where you name a person, upload any pile of pages about them (.txt, .md, .html, .pdf or .docx), and press **Write the story**. The pages are chunked, embedded and stored in Postgres with pgvector. The app then runs the 20 questions and writes a story from what it retrieved. Every sentence ends with the IDs of the chunks it came from, and you can click an ID to read the passage. Sentences the checker couldn't verify are highlighted. Questions with nothing relevant in the pages are listed as "Not in the sources." and left out of the story. You can also ask your own question; that's how the canary test runs. Every run can be downloaded as story.md, log.md and log.json. Nothing in the code is specific to Franklin.

## How "only from the snippets" is enforced

I didn't trust a single "only use the context" instruction, so the pipeline narrows what the model can see at each step and then checks the output mechanically:

1. **Retrieval per question:** a hybrid of vector search (exact cosine over the collection) and Postgres full-text search, fused by reciprocal rank, keeping the top 8 chunks. The keyword half drops the person's own name, since it appears in every chunk. It also adds generic hint words per question ("funny, humor, joke, laughed" for the funny anecdote), because vague questions embed poorly.
2. **Extraction:** the model sees only those 8 snippets and must return facts, each with chunk IDs and a word-for-word quote. Each fact is then checked mechanically:
   - The quote must actually appear in a cited chunk, or the fact is dropped.
   - Every name and number in the fact must appear in its cited chunks, or the fact is dropped.

   If nothing survives, the answer is "Not in the sources."
3. **Story writing:** the model gets only the surviving facts (with their quotes and IDs), never the open question. It returns the story as structured JSON, one sentence at a time, each with its chunk IDs. Every sentence is therefore traceable by construction, not by parsing citations out of prose.
4. **Verification:** deterministic checks (every sentence cited, every citation belongs to a retrieved fact, no names or numbers missing from the cited chunks) plus an LLM judge that sees only the cited chunk text. Anything that fails is flagged in the story as possibly coming from the model's training data.

## What the review of the logs found

The details are in [`REVIEW.md`](samples/franklin/REVIEW.md). I ran the Franklin story three times and fixed what each review found:

- **Run 1:** no leaks, but a misleading "on a later trip" and an anecdote called funny that the source never calls funny.
- **Run 2 caught a real training-data leak:** the story said Franklin married "Miss **Deborah** Read", while the cited chunks only say "Miss Read". The model had filled in her first name from memory. Its quote was genuine, so the quote check passed, but my new name-and-number check flagged it. I then moved that check up to the fact level, so a remembered detail is dropped before the story is written.
- **Run 3 (the hand-in):**
  - 38 of 38 sentences are cited, all 20 questions are answered, and no names or numbers come from outside the cited chunks.
  - One sentence ("he lived in Philadelphia") is flagged because its chunk doesn't quite say that.
  - **The app missed one error, which I found by hand:** it merged Franklin's two sons into one sentence. This is a misreading of the source, not training data, and REVIEW.md flags it.
- **Canary:** "On which US banknote does Franklin's portrait appear?" ($100 bill) and "When did the Benjamin Franklin Bridge open?" (1926) are true but not in the corpus; I checked by searching all 7 books. Both came back **"Not in the sources."** A control question that *is* in the corpus ("Where was he born?") was answered with citations.

## Corpus

Seven public-domain Franklin biographies from Project Gutenberg, about 1,794 pages after cleanup (1,725 chunks). They are the Autobiography, Morse (1889), Fisher (1899), More (1900), Thayer, Goodrich and Bigelow. The list is in [`corpus/franklin/SOURCES.md`](corpus/franklin/SOURCES.md). Older biographies were a deliberate choice: they make canary questions easy to find, since anything after about 1900 can't be in them.

## Stack and cost

- Node 22 and Express on Render (free plan), with Neon Postgres and pgvector.
- OpenAI `text-embedding-3-small` for embeddings and `gpt-5.4-mini` for extraction, writing and judging.
- The frontend is one page of vanilla JS and Tailwind.
- Ingesting the 1,794-page corpus took about 40 seconds and cost about $0.015. A full 20-question story run takes 40 to 60 seconds and costs about $0.12.
- Because the public site spends my API credit, it has upload size limits, per-IP rate limits, at most two concurrent story runs, and a $3/day spend cap. Only the browser that created a collection can add pages to it.
- 108 automated tests (`npm test`) run the whole flow, from upload through story, logs and canary, on a free mock model with an in-memory database.

## How I worked

I planned the design first, then wrote a short interface contract ([`docs/CONTRACT.md`](docs/CONTRACT.md)), so three tracks could run in parallel. I wrote the backend. A subagent wrote the test suite against the contract, and another built the frontend against demo fixtures. A third subagent downloaded the corpus; Gutenberg was down for maintenance, so it used the official PG mirror. After merging, I ran the real pipeline, reviewed the logs by hand, and tightened the prompts and checks twice based on what the review found.
