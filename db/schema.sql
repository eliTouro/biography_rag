-- Biography RAG schema. Safe to run on every start (idempotent).
create extension if not exists vector;

create table if not exists collections (
  id          text primary key,
  person      text not null,
  aliases     text not null default '',
  owner_hash  text not null,
  created_at  timestamptz not null default now()
);

create table if not exists documents (
  collection_id text not null references collections(id) on delete cascade,
  id            text not null,             -- "D01"
  seq           int  not null,
  filename      text not null,
  bytes         int  not null default 0,
  words         int  not null default 0,
  est_pages     int  not null default 0,
  chunks        int  not null default 0,
  status        text not null default 'queued',
  error         text,
  created_at    timestamptz not null default now(),
  primary key (collection_id, id)
);

-- One row per chunk. Exact (non-indexed) cosine search per collection: a collection is at most
-- a few thousand chunks, so a sequential scan is fast and never misses a neighbour the way a
-- filtered approximate (HNSW) search can.
create table if not exists chunks (
  collection_id text not null references collections(id) on delete cascade,
  id            text not null,             -- "D01-C0042"
  doc_id        text not null,
  ord           int  not null,
  page          int,
  words         int  not null,
  text          text not null,
  tsv           tsvector generated always as (to_tsvector('english', text)) stored,
  embedding     vector(1536),
  primary key (collection_id, id)
);
create index if not exists chunks_tsv_idx on chunks using gin (tsv);

create table if not exists runs (
  id            text primary key,
  collection_id text not null references collections(id) on delete cascade,
  kind          text not null,             -- 'story' | 'ask'
  question      text,
  status        text not null default 'running',
  progress      jsonb,
  result        jsonb,
  cost_usd      double precision not null default 0,
  error         text,
  created_at    timestamptz not null default now(),
  finished_at   timestamptz
);
create index if not exists runs_collection_idx on runs (collection_id, created_at desc);

-- Every step of every run: the query, the chunk IDs retrieved, the exact prompt, the reply.
create table if not exists run_log (
  id         bigserial primary key,
  run_id     text not null references runs(id) on delete cascade,
  seq        int  not null,
  step       text not null,
  query      text,
  retrieved  jsonb,
  prompt     jsonb,
  response   jsonb,
  usage      jsonb,
  created_at timestamptz not null default now()
);
create index if not exists run_log_run_idx on run_log (run_id, seq);

create table if not exists spend (
  day date primary key,
  usd double precision not null default 0
);
