const WORKER_API_BASE = "https://movie.sngweijie96.workers.dev";
const API_BASE =
  typeof import.meta !== "undefined" && import.meta.env?.VITE_API_URL
    ? import.meta.env.VITE_API_URL
    : WORKER_API_BASE;

const DEFAULT_MATCH_COUNT = 8;
const DEFAULT_RECOMMENDATION_COUNT = 3;

const state = {
  totalPeople: 0,
  timeAvailable: "",
  currentPersonIndex: 0,
  peopleAnswers: [],
};

const elements = {
  viewStart: document.getElementById("view-start"),
  viewQuestion: document.getElementById("view-question"),
  viewResult: document.getElementById("view-result"),
  btnHome: document.getElementById("btn-home"),
  btnStart: document.getElementById("btn-start"),
  btnNext: document.getElementById("next-btn"),
  btnNextText: document.getElementById("next-btn-text"),
  btnRestart: document.getElementById("btn-restart"),
  peopleCountInput: document.getElementById("people-count-input"),
  timeAvailableInput: document.getElementById("time-available-input"),
  personIndexText: document.getElementById("person-index-text"),
  personLabelText: document.getElementById("person-label-text"),
  progressBar: document.getElementById("progress-bar"),
  answerFavorite: document.getElementById("answer-favorite"),
  answerIsland: document.getElementById("answer-island"),
  startError: document.getElementById("start-error"),
  questionError: document.getElementById("question-error"),
  resultsList: document.getElementById("results-list"),
  resultSubtitle: document.getElementById("result-subtitle"),
};

function showView(viewId) {
  [elements.viewStart, elements.viewQuestion, elements.viewResult].forEach((view) => {
    view.classList.remove("active");
  });
  document.getElementById(viewId)?.classList.add("active");

  window.scrollTo(0, 0);
}

function clearError(el) {
  el.textContent = "";
  el.classList.add("hidden");
}

function showError(el, message) {
  el.textContent = message;
  el.classList.remove("hidden");
}

function setChoice(groupName, value) {
  const group = document.querySelector(`[data-choice-group="${groupName}"]`);
  if (!group) return;

  group.querySelectorAll("[data-choice]").forEach((button) => {
    const isSelected = button.dataset.choice === value;
    button.classList.remove("bg-brand-mint", "text-dark-navy", "font-bold", "border-brand-mint");
    button.classList.add("border-gray-800", "text-gray-400", "font-medium");
    if (isSelected) {
      button.classList.remove("border-gray-800", "text-gray-400", "font-medium");
      button.classList.add("bg-brand-mint", "text-dark-navy", "font-bold", "border-brand-mint");
    }
  });
}

function getSelectedChoice(groupName) {
  const selected = document.querySelector(
    `[data-choice-group="${groupName}"] [data-choice].bg-brand-mint`
  );
  return selected?.dataset.choice ?? "";
}

function setFormValues(values) {
  elements.answerFavorite.value = values.favorite ?? "";
  elements.answerIsland.value = values.island ?? "";
  setChoice("novelty", values.novelty ?? "");
  setChoice("vibe", values.vibe ?? "");
}

function getFormValues() {
  return {
    favorite: elements.answerFavorite.value.trim(),
    novelty: getSelectedChoice("novelty"),
    vibe: getSelectedChoice("vibe"),
    island: elements.answerIsland.value.trim(),
  };
}

function updateQuestionUi() {
  const personNumber = state.currentPersonIndex + 1;
  elements.personIndexText.textContent = String(personNumber);
  elements.personLabelText.textContent = `Person ${personNumber}`;
  elements.btnNextText.textContent =
    personNumber === state.totalPeople ? "GET RECOMMENDATIONS" : "NEXT PERSON";

  const progressPercent = Math.round(((personNumber - 1) / state.totalPeople) * 100);
  elements.progressBar.style.width = `${progressPercent}%`;

  setFormValues(state.peopleAnswers[state.currentPersonIndex] ?? {});
}

function buildCombinedAnswers() {
  const lines = [
    "Group movie recommendation request.",
    `People watching: ${state.totalPeople}.`,
    `Time available: ${state.timeAvailable}.`,
  ];

  state.peopleAnswers.forEach((personAnswers, idx) => {
    lines.push(`Person ${idx + 1} favorite movie and why: ${personAnswers.favorite || "No answer."}`);
    lines.push(`Person ${idx + 1} wants new/classic: ${personAnswers.novelty || "No answer."}`);
    lines.push(`Person ${idx + 1} vibe: ${personAnswers.vibe || "No answer."}`);
    lines.push(
      `Person ${idx + 1} island movie companion and reason: ${personAnswers.island || "No answer."}`
    );
  });

  return lines.join("\n");
}

function escapeHtml(text) {
  return String(text ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatRuntime(runtimeMinutes) {
  if (!Number.isFinite(runtimeMinutes) || runtimeMinutes <= 0) return "Runtime unknown";
  const hours = Math.floor(runtimeMinutes / 60);
  const minutes = runtimeMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

function formatRating(rating) {
  if (!Number.isFinite(rating)) return "Rating unavailable";
  return `Rating ${rating.toFixed(1)}`;
}

function renderRecommendations(recommendations) {
  const cards = recommendations.map((movie, index) => {
    const title = escapeHtml(movie.title || `Recommendation ${index + 1}`);
    const description = escapeHtml(movie.description || "Great fit for your group.");
    const overview = escapeHtml(movie.overview || description);
    const year = escapeHtml(movie.year || "Unknown year");
    const genres = Array.isArray(movie.genres) && movie.genres.length > 0 ? movie.genres.join(", ") : "Unknown genre";
    const posterUrl = movie.posterUrl || "https://placehold.co/500x750/081817/4fe3c3?text=No+Poster";
    const rating = formatRating(Number(movie.rating));
    const runtime = formatRuntime(Number(movie.runtimeMinutes));

    return `
      <article class="bg-[#081817]/80 border border-white/5 rounded-[32px] overflow-hidden flex flex-col md:flex-row shadow-2xl backdrop-blur-sm">
        <div class="md:w-[34%] h-[360px] md:h-auto bg-black/20 flex items-center justify-center p-3">
          <img alt="${title} poster" class="w-full h-full object-contain rounded-xl" src="${escapeHtml(posterUrl)}" />
        </div>
        <div class="md:w-[66%] p-6 md:p-10 flex flex-col gap-5">
          <p class="text-brand-mint text-xs font-bold tracking-[0.2em] uppercase">Recommendation ${index + 1}</p>
          <h2 class="text-3xl font-bold">${title}</h2>
          <div class="flex flex-wrap gap-3 text-sm text-gray-300">
            <span class="bg-brand-mint/20 text-brand-mint px-3 py-1 rounded-md border border-brand-mint/30">${escapeHtml(
              rating
            )}</span>
            <span class="bg-gray-800/70 px-3 py-1 rounded-md">${year} • ${escapeHtml(runtime)}</span>
            <span class="bg-gray-800/70 px-3 py-1 rounded-md">${escapeHtml(genres)}</span>
          </div>
          <p class="text-gray-200 leading-relaxed">${description}</p>
          <p class="text-gray-400 text-sm leading-relaxed">${overview}</p>
        </div>
      </article>
    `;
  });

  elements.resultsList.innerHTML = cards.join("");
  elements.resultSubtitle.textContent = `Built from combined preferences of ${state.totalPeople} people and a ${state.timeAvailable} time window.`;
}

async function getRecommendations(answers) {
  const response = await fetch(`${API_BASE}/api/recommend`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      answers,
      matchCount: DEFAULT_MATCH_COUNT,
      recommendationCount: DEFAULT_RECOMMENDATION_COUNT,
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.details || payload.error || `Request failed (${response.status}).`);
  }
  if (Array.isArray(payload.recommendations) && payload.recommendations.length > 0) {
    return payload.recommendations.slice(0, DEFAULT_RECOMMENDATION_COUNT);
  }
  if (payload.title || payload.description) {
    return [
      {
        title: payload.title || "Recommendation",
        description: payload.description || "No description available.",
      },
    ];
  }
  throw new Error("API returned no recommendations.");
}

function resetExperience() {
  state.totalPeople = 0;
  state.timeAvailable = "";
  state.currentPersonIndex = 0;
  state.peopleAnswers = [];

  elements.peopleCountInput.value = "";
  elements.timeAvailableInput.value = "";
  setFormValues({});
  elements.resultsList.innerHTML = "";
  elements.resultSubtitle.textContent = "";
  clearError(elements.startError);
  clearError(elements.questionError);
  elements.btnNext.disabled = false;
  elements.btnNextText.textContent = "NEXT PERSON";
  elements.progressBar.style.width = "0%";

  showView("view-start");
}

async function onNextPerson() {
  clearError(elements.questionError);
  const formValues = getFormValues();
  const hasAnyAnswer = Object.values(formValues).some(Boolean);
  if (!hasAnyAnswer) {
    showError(elements.questionError, "Please provide at least one answer for this person.");
    return;
  }

  state.peopleAnswers[state.currentPersonIndex] = formValues;

  if (state.currentPersonIndex < state.totalPeople - 1) {
    state.currentPersonIndex += 1;
    updateQuestionUi();
    return;
  }

  elements.btnNext.disabled = true;
  elements.btnNextText.textContent = "GETTING RECOMMENDATIONS...";

  try {
    const combinedAnswers = buildCombinedAnswers();
    const recommendations = await getRecommendations(combinedAnswers);
    renderRecommendations(recommendations);
    showView("view-result");
  } catch (error) {
    showError(elements.questionError, error.message || "Could not get recommendations.");
  } finally {
    elements.btnNext.disabled = false;
    elements.btnNextText.textContent = "GET RECOMMENDATIONS";
  }
}

function onStart() {
  clearError(elements.startError);
  const totalPeople = Number(elements.peopleCountInput.value);
  const timeAvailable = elements.timeAvailableInput.value.trim();

  if (!Number.isInteger(totalPeople) || totalPeople < 1 || totalPeople > 10) {
    showError(elements.startError, "Please enter a number of people between 1 and 10.");
    return;
  }
  if (!timeAvailable) {
    showError(elements.startError, "Please tell us how much time you have.");
    return;
  }

  state.totalPeople = totalPeople;
  state.timeAvailable = timeAvailable;
  state.currentPersonIndex = 0;
  state.peopleAnswers = Array.from({ length: totalPeople }, () => ({
    favorite: "",
    novelty: "",
    vibe: "",
    island: "",
  }));

  updateQuestionUi();
  showView("view-question");
}

elements.btnStart.addEventListener("click", onStart);
elements.btnNext.addEventListener("click", onNextPerson);
elements.btnRestart.addEventListener("click", resetExperience);
elements.btnHome.addEventListener("click", resetExperience);

document.querySelectorAll("[data-choice-group] [data-choice]").forEach((button) => {
  button.addEventListener("click", () => {
    const group = button.closest("[data-choice-group]");
    if (!group) return;
    setChoice(group.dataset.choiceGroup, button.dataset.choice || "");
  });
});
