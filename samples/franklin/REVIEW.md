# Review of the logs: Benjamin Franklin

**Corpus:** 7 public-domain biographies from Project Gutenberg, 493,618 words after stripping Gutenberg boilerplate, about 1,794 pages, split into 1,725 chunks ([`corpus/franklin/SOURCES.md`](../../corpus/franklin/SOURCES.md)).
**Model:** `gpt-5.4-mini` for extraction, weaving and judging. Embeddings: `text-embedding-3-small`.
**Final story:** [`story.md`](story.md). **Logs:** [`log.md`](log.md) (readable) and [`log.json`](log.json) (raw). Every query, the chunk IDs it retrieved with their vector rank, keyword rank and fused score, the exact system and user prompt, and the reply are recorded there.

## How I reviewed

1. **Automatic checks**, which the app runs on every story:
   - every sentence must cite at least one chunk;
   - every cited ID must belong to a fact that came out of a retrieved snippet;
   - every fact's quote must appear in its cited chunk;
   - an LLM judge sees only the cited chunk text and rates each sentence yes / partly / no;
   - (added during this review) every name and number in a sentence must appear in a cited chunk.
2. **By hand:** I read every sentence of the final story against the chunk text it cites (the `chunks` map in [`result.json`](result.json)). For flagged sentences and anything that looked like common Franklin knowledge, I searched the cited chunk for the exact words.

I ran the story three times. Each review found something, I fixed it, and I ran again. The earlier runs are kept in [`run1/`](run1/) and [`run2/`](run2/).

| Run | Sentences | Cited | Flagged | Questions answered | What the review found | What I changed |
|---|---|---|---|---|---|---|
| 1 | 31 | 31 | 1 | 20/20 | No training-data leaks. The one flag ("a brother named John") was a false alarm: D05-C0027 names John among Franklin's elder brothers. Two small slips: "On a later trip" (the squall was on the *same* runaway journey, D03-C0043), and the "funny" anecdote was labelled humorous though the source never calls it that. | Added the name-and-number check. Story prompt: time words only when the facts give the order. Extraction prompt: don't call something funny or dangerous unless the source does. |
| 2 | 39 | 39 | 5 | 20/20 | **One real training-data leak, caught:** "married Miss **Deborah** Read" (S17). The three cited chunks only say "Miss Read". The extraction model filled in her first name from memory, and the quote check passed because the quote itself was genuine. The new check flagged it in the story. Two flags were paraphrase drift the judge rightly caught (S34, S38). One was a false alarm ("17" against "17th"). One came from a table-of-contents chunk (S15, "employed at Burlington"). | Ran the name-and-number check on each **fact** too, so a leaked name is dropped before the story is written. Extraction prompt: write names exactly as the snippets do. Numbers now match ordinals ("17" = "17th"). |
| 3 (final) | 38 | 38 | 1 | 20/20 | See below. | None; this is the hand-in story. |

The funny anecdote also improved between runs. Run 1 used a clerk-election story the source doesn't call funny. Runs 2 and 3 use the chess game with the Duchess of Bourbon ("We do in America"), D04-C0077.

## Final story (run 3): sentence-by-sentence result

- **38 of 38 sentences cite a chunk. Every cited chunk was retrieved for that run.**
- **No sentence contains a name or number absent from its cited chunks** (automatic check, then confirmed by hand).
- **"Deborah Read" is now supported.** The sentence cites D02-C0023, which says "engaged himself to Miss Deborah Read".
- **Flagged by the app (1):**
  - S24 "He lived in Philadelphia and spent much of his life there." [D06-C0098]. The judge said "partly", and I agree. The chunk is about Franklin losing his Philadelphia assembly seat. It mentions the city but doesn't say he lived there. **Not training data in its wording, but the claim leans on outside knowledge.**
- **Missed by the app, found by hand (1):**
  - S33 "He said that his greatest sorrow was the loss of his only legitimate son, William, …" [D07-C0035]. This is wrong. The chunk says William's loyalty to the Crown was a sorrow "next to the loss of his only legitimate son", which means the son who died young (S32). William was not his legitimate son (S21 says so). The model merged two sons into one, and the judge passed it. **This is a reading error rather than training data,** since all the words come from the chunk, but it is a false statement in the story.
- **Conflicting sources handled correctly:** S1 gives both birth dates the sources use (January 6, 1706, old style, and January 17, 1706). S21 and S22 report the children as the sources do. The corpus itself disagrees on the number of siblings: D07-C0001 says "youngest of ten children", while D04-C0002 says "seventeen". The final story avoids the number.
- **Rejected facts (1):** in Q19 the model quoted the heading "His Fondness for Reading." in a form that isn't in the chunk, so the fact was dropped. The question was still answered from the other facts.

**Verdict:** nothing in the final story comes from the model's training data. One sentence (S24) leans on outside knowledge and is flagged in the story. One sentence (S33) misreads its source; the app did not flag it, and I flag it here.

## Canary test

[`canary.md`](canary.md) holds the questions, answers, retrieved chunks and full prompts. Before running, I searched all 7 books (case-insensitive) for "hundred dollar", "$100 bill", "banknote", "Franklin Bridge", "1914" and "1926". The only hits were "$100,000" (a loan) and "American Bank Note Co." (a picture credit). Neither says anything about Franklin's portrait on money.

| Question | True answer (not in corpus) | App's answer |
|---|---|---|
| On which US banknote does Benjamin Franklin's portrait appear? | The $100 bill | **Not in the sources.** ✅ |
| When did the Benjamin Franklin Bridge between Philadelphia and Camden open? | 1926 | **Not in the sources.** ✅ |
| Control: Where was Benjamin Franklin born? (in the corpus) | Boston | Boston, a house on Milk Street opposite the Old South Church [D07-C0001][D04-C0003][D02-C0012][D03-C0065] ✅ |

The model certainly knows both canary answers. In the logs, the retrieved snippets for the banknote question are about Franklin's family and early life. The model returned `found:false` instead of answering from memory.

## Limitations the review surfaced

- The judge is one LLM call with low reasoning effort. It catches added details and interpretive wording well, but it missed a relationship mix-up (S33). The name-and-number check can't see that kind of error either, because every word is in the source.
- Table-of-contents chunks (chapter lists) can be retrieved and used as facts ("Employed at Burlington", run 2). It's technically in the source but thin evidence. Filtering contents pages at ingestion would help.
- The questions with fuzzy topics ("funny", "a habit or quirk") depend on retrieval luck. The generic keyword hints in `src/queries.js` help, but a different corpus may still come back thin on them, and then the answer is "Not in the sources.", which is the intended behaviour.
- Costs: each full story run was about $0.12 and 40 to 60 seconds. Ingesting the 1,794-page corpus cost about $0.015 and took 40 seconds.
