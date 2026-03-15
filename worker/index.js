import { createClient } from "@supabase/supabase-js";

const EMBEDDING_MODEL = "text-embedding-3-small";
const DEFAULT_CHAT_MODEL = "openai/gpt-5-nano";
const DEFAULT_MATCH_COUNT = 8;
const DEFAULT_RECOMMENDATION_COUNT = 3;
const RPC_TIMEOUT_MS = 10000;
const TMDB_TIMEOUT_MS = 10000;
const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/w500";
const AI_GATEWAY_CHAT_URL =
  "https://gateway.ai.cloudflare.com/v1/7e59acd1ddd458a26c26b695c504c946/movies-recommendation-app/compat/chat/completions";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
  };
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(),
    },
  });
}

function providerErrorMessage(payload, fallback) {
  if (typeof payload?.error?.message === "string" && payload.error.message) {
    return payload.error.message;
  }
  if (Array.isArray(payload?.error) && payload.error.length > 0) {
    return payload.error.map((item) => item?.message).filter(Boolean).join("; ") || fallback;
  }
  if (typeof payload?.message === "string" && payload.message) {
    return payload.message;
  }
  return fallback;
}

function getOpenAiTimeoutMs(env) {
  return Math.max(Number(env.OPENAI_TIMEOUT_MS) || 90000, 5000);
}

function assertRequiredEnv(env) {
  const missing = [
    "OPENAI_API_KEY",
    "SUPABASE_URL",
    "SUPABASE_API_KEY",
    "API_TOKEN",
  ].filter((key) => !env[key]);

  if (missing.length > 0) {
    throw new Error(`Missing required Worker secret(s): ${missing.join(", ")}`);
  }
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    throw new Error("Request body must be valid JSON.");
  }
}

async function openAiEmbeddings(text, env) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), getOpenAiTimeoutMs(env));
  try {
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: text,
      }),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.error?.message || `OpenAI embeddings failed (${response.status}).`);
    }
    const embedding = payload?.data?.[0]?.embedding;
    if (!Array.isArray(embedding) || embedding.length === 0) {
      throw new Error("OpenAI embeddings response was invalid.");
    }
    return embedding;
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("OpenAI request timed out.");
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function openAiGatewayChat(messages, env) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), getOpenAiTimeoutMs(env));
  try {
    const response = await fetch(AI_GATEWAY_CHAT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        "cf-aig-authorization": `Bearer ${env.API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: env.OPENAI_CHAT_MODEL || DEFAULT_CHAT_MODEL,
        messages,
      }),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(providerErrorMessage(payload, `AI Gateway chat failed (${response.status}).`));
    }
    return payload;
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("OpenAI request timed out.");
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function matchMoviesRpc(supabase, queryEmbedding, matchCount) {
  const rpcPromise = supabase.rpc("match_movies", {
    query_embedding: queryEmbedding,
    match_threshold: -1,
    match_count: matchCount,
  });

  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("RPC timeout")), RPC_TIMEOUT_MS)
  );
  const result = await Promise.race([rpcPromise, timeoutPromise]);
  if (result.error) throw result.error;
  return result.data ?? [];
}

async function matchMoviesFallback(supabase, matchCount) {
  const { data, error } = await supabase
    .from("movies")
    .select("id, content")
    .limit(matchCount);
  if (error) throw error;
  return Array.isArray(data) ? data.map((row) => ({ ...row, similarity: 0 })) : [];
}

function parseYear(text) {
  const match = String(text ?? "").match(/\b(19|20)\d{2}\b/);
  return match ? Number(match[0]) : null;
}

function parseRuntimeMinutes(text) {
  const input = String(text ?? "");
  const hoursAndMinutes = input.match(/(\d+)\s*hr(?:\s*(\d+)\s*min)?/i);
  if (hoursAndMinutes) {
    const hours = Number(hoursAndMinutes[1] || 0);
    const minutes = Number(hoursAndMinutes[2] || 0);
    return hours * 60 + minutes;
  }
  const minutesOnly = input.match(/(\d+)\s*min/i);
  return minutesOnly ? Number(minutesOnly[1]) : null;
}

function parseRating(text) {
  const match = String(text ?? "").match(/rated\s*([0-9.]+)\s*on\s*(?:imdb|tmdb)/i);
  return match ? Number(match[1]) : null;
}

function inferTitleFromContent(content, fallbackTitle = "Recommended Movie") {
  const source = String(content ?? "").trim();
  if (!source) return fallbackTitle;

  const line = source.split("\n")[0]?.trim() ?? "";
  const titleWithYear = line.match(/^(.+?)\s*\((?:19|20)\d{2}\)/);
  if (titleWithYear?.[1]) return titleWithYear[1].trim();

  const titleBeforeColon = line.match(/^([^:]{2,90}):/);
  if (titleBeforeColon?.[1]) return titleBeforeColon[1].trim();

  const words = line.split(" ").slice(0, 10).join(" ").trim();
  return words || fallbackTitle;
}

function firstJsonObject(text) {
  const input = String(text ?? "");
  const start = input.indexOf("{");
  const end = input.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return input.slice(start, end + 1);
}

function normalizeRecommendation(raw, fallback = {}) {
  const title = String(raw?.title ?? fallback.title ?? "").trim();
  const description = String(raw?.description ?? fallback.description ?? "").trim();
  const overview = String(raw?.overview ?? fallback.overview ?? description).trim();
  const runtimeMinutes = Number(raw?.runtimeMinutes ?? fallback.runtimeMinutes);
  const rating = Number(raw?.rating ?? fallback.rating);
  const yearValue = Number(raw?.year ?? fallback.year);
  const genres = Array.isArray(raw?.genres)
    ? raw.genres.map((genre) => String(genre).trim()).filter(Boolean)
    : Array.isArray(fallback.genres)
      ? fallback.genres
      : [];

  return {
    title: title || fallback.title || "Recommended Movie",
    description: description || fallback.description || "Great fit for your group.",
    overview: overview || fallback.overview || "",
    year: Number.isFinite(yearValue) ? yearValue : null,
    runtimeMinutes: Number.isFinite(runtimeMinutes) ? runtimeMinutes : null,
    rating: Number.isFinite(rating) ? rating : null,
    genres,
    posterUrl: null,
  };
}

function fallbackRecommendationsFromMatches(matches, recommendationCount) {
  const unique = [];
  for (const match of matches) {
    const content = String(match?.content ?? "");
    const title = inferTitleFromContent(content);
    if (unique.some((entry) => entry.title.toLowerCase() === title.toLowerCase())) continue;
    unique.push(
      normalizeRecommendation({
        title,
        description: content.slice(0, 240),
        overview: content.slice(0, 400),
        year: parseYear(content),
        runtimeMinutes: parseRuntimeMinutes(content),
        rating: parseRating(content),
      })
    );
    if (unique.length >= recommendationCount) break;
  }
  return unique;
}

function logSupabaseMatches(matches) {
  if (!Array.isArray(matches) || matches.length === 0) {
    console.log("[Worker API] Supabase match log: no chunks returned.");
    return;
  }

  console.log(`[Worker API] Supabase match log: ${matches.length} chunks returned.`);
  const titleCounts = new Map();

  matches.forEach((match, index) => {
    const rawContent = String(match?.content ?? "");
    const compactContent = rawContent.replace(/\s+/g, " ").trim();
    const inferredTitle = inferTitleFromContent(compactContent, "(title not in chunk)");
    const similarity = Number.isFinite(Number(match?.similarity))
      ? Number(match.similarity).toFixed(4)
      : "n/a";
    const preview = compactContent.slice(0, 180);

    titleCounts.set(inferredTitle, (titleCounts.get(inferredTitle) ?? 0) + 1);
    console.log(
      `[Worker API] Match #${index + 1} similarity=${similarity} inferredTitle="${inferredTitle}" preview="${preview}${compactContent.length > 180 ? "..." : ""}"`
    );
  });

  const grouped = [...titleCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([title, count]) => `${title} (${count} chunks)`)
    .join(", ");
  console.log(
    `[Worker API] Chunk grouping (inferred titles): ${grouped || "No title grouping available."}`
  );
}

async function generateOpenAiRecommendations(preferences, context, recommendationCount, env) {
  const systemContent = `You are a movie recommendation assistant.
Given user preferences and matched movie descriptions, return exactly ${recommendationCount} recommendations.
Return strict JSON only in this shape:
{
  "recommendations": [
    {
      "title": "Movie title",
      "description": "2-3 sentences explaining why this fits the group",
      "year": 2023,
      "runtimeMinutes": 120,
      "rating": 7.8,
      "genres": ["Drama", "Sci-Fi"],
      "overview": "Short synopsis"
    }
  ]
}
No markdown fences and no extra keys outside recommendations.`;

  const userContent = `User preferences:\n${preferences}\n\nMatched movie descriptions:\n${context}`;

  const completion = await openAiGatewayChat(
    [
      { role: "system", content: systemContent },
      { role: "user", content: userContent },
    ],
    env
  );

  const contentText = completion?.choices?.[0]?.message?.content ?? "";
  const jsonText = firstJsonObject(contentText);
  if (!jsonText) return [];

  try {
    const parsed = JSON.parse(jsonText);
    return Array.isArray(parsed?.recommendations) ? parsed.recommendations : [];
  } catch {
    return [];
  }
}

function normalizeTmdbTitle(title) {
  return String(title ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function tmdbGet(path, params, env) {
  if (!env.TMDB_API_KEY) return null;

  const url = new URL(`https://api.themoviedb.org/3${path}`);
  url.searchParams.set("api_key", env.TMDB_API_KEY);
  Object.entries(params ?? {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TMDB_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`TMDB request failed (${response.status})`);
    return await response.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

function chooseBestTmdbResult(title, results) {
  const normalizedTitle = normalizeTmdbTitle(title);
  const exact = results.find((item) => normalizeTmdbTitle(item?.title) === normalizedTitle);
  return exact ?? results[0] ?? null;
}

async function enrichWithTmdb(recommendation, env) {
  if (!env.TMDB_API_KEY) return recommendation;
  try {
    const searchPayload = await tmdbGet(
      "/search/movie",
      {
        query: recommendation.title,
        include_adult: "false",
        language: "en-US",
        year: recommendation.year ?? undefined,
        page: 1,
      },
      env
    );
    const results = Array.isArray(searchPayload?.results) ? searchPayload.results : [];
    if (results.length === 0) return recommendation;

    const best = chooseBestTmdbResult(recommendation.title, results);
    if (!best?.id) return recommendation;

    const detail = await tmdbGet(`/movie/${best.id}`, { language: "en-US" }, env);
    const year = parseYear(detail?.release_date) ?? parseYear(best?.release_date) ?? recommendation.year ?? null;
    const posterPath = detail?.poster_path ?? best?.poster_path;

    return {
      ...recommendation,
      year,
      posterUrl: posterPath ? `${TMDB_IMAGE_BASE}${posterPath}` : recommendation.posterUrl,
      runtimeMinutes: detail?.runtime ?? recommendation.runtimeMinutes,
      rating:
        Number.isFinite(detail?.vote_average) && detail.vote_average > 0
          ? Number(detail.vote_average.toFixed(1))
          : recommendation.rating,
      genres:
        Array.isArray(detail?.genres) && detail.genres.length > 0
          ? detail.genres.map((genre) => genre?.name).filter(Boolean)
          : recommendation.genres,
      overview: detail?.overview || recommendation.overview,
    };
  } catch (error) {
    console.warn(`[Worker API] TMDB enrichment failed for "${recommendation.title}":`, error.message);
    return recommendation;
  }
}

async function handleRecommend(request, env) {
  assertRequiredEnv(env);
  const body = await readJson(request);
  const {
    answers,
    matchCount = DEFAULT_MATCH_COUNT,
    recommendationCount = DEFAULT_RECOMMENDATION_COUNT,
  } = body ?? {};

  if (!answers || typeof answers !== "string") {
    return jsonResponse({ error: "Missing or invalid 'answers' string." }, 400);
  }

  const trimmed = answers.trim();
  if (!trimmed) {
    return jsonResponse({ error: "Answers cannot be empty." }, 400);
  }

  const wantedRecommendations = Math.min(
    Math.max(Number(recommendationCount) || DEFAULT_RECOMMENDATION_COUNT, 1),
    5
  );
  const count = Math.min(
    Math.max(Number(matchCount) || DEFAULT_MATCH_COUNT, wantedRecommendations, 1),
    20
  );

  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_API_KEY);

  console.log("[Worker API] Embedding user answers...");
  const queryEmbedding = await openAiEmbeddings(trimmed, env);
  console.log("[Worker API] Querying Supabase (match_movies RPC)...");

  let matches;
  try {
    matches = await matchMoviesRpc(supabase, queryEmbedding, count);
  } catch (error) {
    if (error?.message === "RPC timeout") {
      console.warn("[Worker API] RPC timed out, using Supabase fallback select.");
      matches = await matchMoviesFallback(supabase, count);
    } else {
      throw error;
    }
  }

  if (!Array.isArray(matches) || matches.length === 0) {
    matches = await matchMoviesFallback(supabase, count);
  }

  console.log("[Worker API] Got", matches.length, "matches from Supabase");
  logSupabaseMatches(matches);

  const context = matches.length > 0 ? matches.map((m) => m.content).join("\n\n") : "No similar movies found.";
  console.log("[Worker API] Calling AI Gateway for top recommendations...");

  const openAiRecommendations = await generateOpenAiRecommendations(
    trimmed,
    context,
    wantedRecommendations,
    env
  );
  const fallbackRecommendations = fallbackRecommendationsFromMatches(matches, wantedRecommendations);

  const normalizedRecommendations = [];
  for (let i = 0; i < wantedRecommendations; i += 1) {
    const openAiItem = openAiRecommendations[i];
    const fallbackItem =
      fallbackRecommendations[i] ??
      normalizeRecommendation({
        title: `Recommendation ${i + 1}`,
        description: "A strong match for your group preferences.",
      });
    normalizedRecommendations.push(normalizeRecommendation(openAiItem, fallbackItem));
  }

  const recommendations = await Promise.all(
    normalizedRecommendations.map((recommendation) => enrichWithTmdb(recommendation, env))
  );

  const first = recommendations[0] ?? {};
  return jsonResponse({
    recommendations,
    title: first.title ?? "A great pick",
    description: first.description ?? "We think you'll love it.",
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    if (url.pathname === "/api/recommend" && request.method === "POST") {
      try {
        return await handleRecommend(request, env);
      } catch (error) {
        console.error("[Worker API] Recommend error:", error?.message || error);
        return jsonResponse(
          {
            error: "Recommendation failed.",
            details: error?.message || "Unknown error",
          },
          500
        );
      }
    }

    if (url.pathname === "/" && request.method === "GET") {
      return jsonResponse({
        ok: true,
        service: "PopChoice Worker API",
        route: "/api/recommend",
      });
    }

    return jsonResponse({ error: "Not found." }, 404);
  },
};
