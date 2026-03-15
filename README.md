# PopChoice - Group Movie Recommender

PopChoice is a multi-user movie recommendation app where each person shares preferences, the answers are combined into one sentiment profile, and the app returns top movie picks with poster/details.

This project showcases:

- multi-user frontend flow with dynamic recommendation cards
- vector similarity search using Supabase + pgvector
- LLM reasoning with OpenAI via Cloudflare AI Gateway
- movie metadata/poster enrichment with TMDB
- backend migration to Cloudflare Workers with secrets kept on Cloudflare

## How it works

1. Users enter:
   - number of people watching
   - time available
   - 4 preference answers per person
2. Frontend combines all answers into one text prompt.
3. Backend embeds that text with OpenAI embeddings (`text-embedding-3-small`).
4. Supabase RPC (`match_movies`) returns top matching chunks from the `movies` table.
5. Backend sends user preferences + matched chunks to OpenAI chat to generate top recommendations.
6. Backend enriches each recommendation with TMDB details (poster, runtime, rating, genres).
7. Frontend renders recommendation cards.

## APIs and services used

### OpenAI

- Embeddings endpoint: `https://api.openai.com/v1/embeddings`
- Model used: `text-embedding-3-small`

### Cloudflare AI Gateway (OpenAI-compatible chat)

- Endpoint:
  - `https://gateway.ai.cloudflare.com/v1/7e59acd1ddd458a26c26b695c504c946/movies-recommendation-app/compat/chat/completions`
- Required outbound headers from Worker:
  - `Authorization: Bearer <OPENAI_API_KEY>`
  - `cf-aig-authorization: Bearer <API_TOKEN>`
- Model used for recommendations (default): `openai/gpt-5-nano`

### Supabase

- Stores chunk embeddings in `movies` table (`vector(1536)`).
- Uses SQL function `match_movies` for similarity search.
- Schema is in `supabase/schema.sql`.

### TMDB

- Used to enrich recommendations with:
  - poster URL
  - runtime
  - vote average
  - genres
  - overview

## Project structure

- `index.html` - app UI markup and styles
- `index.js` - frontend app logic (multi-user flow + API call + rendering)
- `server/index.js` - legacy local Express backend (kept for local fallback/testing)
- `worker/index.js` - Cloudflare Worker backend (recommended deployment target)
- `wrangler.jsonc` - Cloudflare Worker config
- `content.js` - source movie dataset
- `scripts/seed-content.js` - chunks + embeds dataset and uploads to Supabase

## Local setup

1. Install dependencies:

```bash
npm install
```

2. Copy env template:

```bash
cp .env.example .env
```

3. Fill `.env` values (`OPENAI_API_KEY`, `SUPABASE_URL`, `SUPABASE_API_KEY`, `TMDB_API_KEY`).

4. Seed Supabase data:

```bash
npm run seed:content
```

5. Run frontend:

```bash
npm run dev
```

6. Choose backend mode:

- Cloudflare Worker backend (default):
  - frontend uses `https://movie.sngweijie96.workers.dev` by default
- Local Express backend (optional):
  - run `npm run server`
  - set `VITE_API_URL=http://localhost:3001` in `.env`

## Deploy Worker to Cloudflare

1. Ensure Worker secrets exist on Cloudflare:
   - `OPENAI_API_KEY`
   - `SUPABASE_URL`
   - `SUPABASE_API_KEY`
   - `TMDB_API_KEY`
   - `API_TOKEN`
2. Validate and deploy:

```bash
npm run worker:check
npm run worker:deploy
```

3. Test endpoint:

```bash
curl -X POST "https://movie.sngweijie96.workers.dev/api/recommend" \
  -H "Content-Type: application/json" \
  -d '{"answers":"2 people. We want an emotional sci-fi movie with great visuals.","matchCount":8,"recommendationCount":3}'
```

## What I learned (showcase notes)

- how chunked embeddings still work for full-movie recommendations through aggregate retrieval context
- how to combine vector search + LLM reasoning + metadata enrichment in one API
- how to protect keys with Cloudflare Worker secrets instead of exposing them client-side
- how to route OpenAI chat traffic through AI Gateway with authenticated headers