/**
 * One-time script to chunk movies.txt, embed with OpenAI, and upload to Supabase.
 * Run: node scripts/seed-movies.js
 *
 * Requires:
 * - .env with OPENAI_API_KEY, SUPABASE_URL, SUPABASE_API_KEY
 * - The "movies" table and match_movies() function already exist in Supabase.
 *   If you deleted the table, recreate it by running supabase/schema.sql in the
 *   Supabase Dashboard → SQL Editor, then run this script again.
 */

import "dotenv/config";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { openai, supabase } from "../config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data");
const MOVIES_JSON = join(DATA_DIR, "movies.json");
const EMBEDDING_MODEL = "text-embedding-3-small";

async function loadAndSplitMovies() {
  const path = join(__dirname, "..", "movies.txt");
  const text = readFileSync(path, "utf-8");
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 250,
    chunkOverlap: 35,
    separators: ["\n\n", "\n", " ", ""],
  });
  return splitter.createDocuments([text]);
}

async function createAndStoreEmbeddings() {
  const chunks = await loadAndSplitMovies();
  console.log("Split into", chunks.length, "chunks.");
  const data = await Promise.all(
    chunks.map(async (chunk) => {
      const embeddingResponse = await openai.embeddings.create({
        model: EMBEDDING_MODEL,
        input: chunk.pageContent,
      });
      return {
        content: chunk.pageContent,
        embedding: embeddingResponse.data[0].embedding,
      };
    })
  );
  const { error } = await supabase.from("movies").insert(data);
  if (error) throw error;
  console.log("Inserted", data.length, "chunks into movies table.");

  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(MOVIES_JSON, JSON.stringify(data), "utf-8");
  console.log("Wrote", MOVIES_JSON, "for server to use (no Supabase needed at runtime).");
}

createAndStoreEmbeddings().catch((err) => {
  console.error("Seed failed:", err.message || err);
  process.exit(1);
});
