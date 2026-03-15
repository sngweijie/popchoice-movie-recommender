/**
 * Frontend: combine answers, call recommendation API, show result.
 * API base URL is set in Vite env (VITE_API_URL) or defaults to same-origin /api.
 */

const API_BASE = typeof import.meta !== "undefined" && import.meta.env?.VITE_API_URL
  ? import.meta.env.VITE_API_URL
  : "http://localhost:3001";

const questionsView = document.getElementById("questions-view");
const outputView = document.getElementById("output-view");
const loadingView = document.getElementById("loading-view");
const btnSubmit = document.getElementById("btn-submit");
const btnRestart = document.getElementById("btn-restart");
const movieTitleEl = document.getElementById("movie-title");
const movieDescriptionEl = document.getElementById("movie-description");

function showView(active) {
  questionsView.classList.add("hidden");
  outputView.classList.add("hidden");
  loadingView.classList.add("hidden");
  if (active === "questions") questionsView.classList.remove("hidden");
  else if (active === "output") outputView.classList.remove("hidden");
  else if (active === "loading") loadingView.classList.remove("hidden");
}

function combineAnswers() {
  const q1 = document.getElementById("fav-movie")?.value?.trim() ?? "";
  const q2 = document.getElementById("mood-timing")?.value?.trim() ?? "";
  const q3 = document.getElementById("vibe")?.value?.trim() ?? "";
  return [q1, q2, q3].filter(Boolean).join(" ");
}

async function getRecommendation(answers) {
  const url = `${API_BASE}/api/recommend`;
  console.log("[PopChoice] Sending request to", url);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      answers,
      matchCount: 5,
    }),
  });
  console.log("[PopChoice] Response status:", res.status, res.statusText);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    console.error("[PopChoice] Error response:", err);
    throw new Error(err.details || err.error || `Request failed: ${res.status}`);
  }
  const data = await res.json();
  console.log("[PopChoice] Got recommendation:", data?.title);
  return data;
}

btnSubmit.addEventListener("click", async () => {
  const answers = combineAnswers();
  console.log("[PopChoice] Let's Go clicked, answers length:", answers.length);
  if (!answers) {
    alert("Please answer at least one question.");
    return;
  }
  showView("loading");
  try {
    const { title, description } = await getRecommendation(answers);
    movieTitleEl.textContent = title;
    movieDescriptionEl.textContent = description;
    showView("output");
    console.log("[PopChoice] Done, showing result.");
  } catch (e) {
    console.error("[PopChoice] Request failed:", e.message, e);
    alert("Could not get a recommendation: " + e.message);
    showView("questions");
  }
});

btnRestart.addEventListener("click", () => {
  showView("questions");
});
