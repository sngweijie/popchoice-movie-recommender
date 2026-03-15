/**
 * One-time script to chunk content.js movie entries, embed, and upload to Supabase.
 * Run: node scripts/seed-content.js
 *
 * Requires:
 * - .env with OPENAI_API_KEY, SUPABASE_URL, SUPABASE_API_KEY
 * - The "movies" table exists (see supabase/schema.sql).
 */

import "dotenv/config";
import { mkdirSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { openai, supabase } from "../config.js";
import movies from "../content.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data");
const CONTENT_JSON = join(DATA_DIR, "content-embeddings.json");
const EMBEDDING_MODEL = "text-embedding-3-small";
const CHUNK_SIZE = 250;
const CHUNK_OVERLAP = 35;

function buildEmbeddingInput(movie) {
  return [
    `${movie.title} (${movie.releaseYear})`,
    movie.content,
  ]
    .filter(Boolean)
    .join("\n")
    .trim();
}

async function loadAndSplitContentMovies() {
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: CHUNK_SIZE,
    chunkOverlap: CHUNK_OVERLAP,
    separators: ["\n\n", "\n", " ", ""],
  });

  const allChunks = [];
  for (const movie of movies) {
    const input = buildEmbeddingInput(movie);
    const docs = await splitter.createDocuments([input]);
    allChunks.push(...docs.map((doc) => doc.pageContent));
  }
  return allChunks;
}

async function createAndStoreEmbeddings() {
  if (!Array.isArray(movies) || movies.length === 0) {
    throw new Error("content.js does not export any movie entries.");
  }

  console.log("Loaded", movies.length, "movies from content.js.");
  const chunks = await loadAndSplitContentMovies();
  console.log("Split into", chunks.length, "chunks.");

  const { error: clearError } = await supabase.from("movies").delete().not("id", "is", null);
  if (clearError) throw clearError;
  console.log("Cleared existing rows from movies table.");

  const rows = await Promise.all(
    chunks.map(async (chunk) => {
      const embeddingResponse = await openai.embeddings.create({
        model: EMBEDDING_MODEL,
        input: chunk,
      });
      return {
        content: chunk,
        embedding: embeddingResponse.data[0].embedding,
      };
    })
  );

  const { error } = await supabase.from("movies").insert(rows);
  if (error) throw error;
  console.log("Inserted", rows.length, "rows into movies table.");

  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(CONTENT_JSON, JSON.stringify(rows), "utf-8");
  console.log("Wrote", CONTENT_JSON);
}

createAndStoreEmbeddings().catch((err) => {
  console.error("Seed failed:", err.message || err);
  process.exit(1);
});
