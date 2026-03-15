-- Enable the pgvector extension for storing and querying embeddings.
create extension if not exists vector;

-- Movies table: each row is a chunk of text (from movies.txt) with its embedding.
create table if not exists movies (
  id uuid primary key default gen_random_uuid(),
  content text not null,
  embedding vector(1536) not null
);

-- Optional: index for faster similarity search on large tables.
-- Uncomment when you have many rows and queries are slow.
-- create index on movies using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- RPC: return the top N movies by cosine similarity to the query embedding.
-- query_embedding: embedding vector from your app (e.g. OpenAI).
-- match_threshold: optional minimum similarity 0–1; use -1 or very low value to return top N regardless.
-- match_count: max number of results (e.g. 4).
create or replace function match_movies(
  query_embedding vector(1536),
  match_threshold float default -1,
  match_count int default 5
)
returns table (
  id uuid,
  content text,
  similarity float
)
language sql stable
as $$
  select
    m.id,
    m.content,
    1 - (m.embedding <=> query_embedding) as similarity
  from movies m
  where 1 - (m.embedding <=> query_embedding) > match_threshold
  order by m.embedding <=> query_embedding
  limit match_count;
$$;
