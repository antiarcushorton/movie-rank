
"use strict";

const STORAGE_KEY = "movie-rankings-app-v1";
const STARTING_RATING = 1500;
const K_FACTOR = 32;

const DEFAULT_TITLES = [
  "Send Help",
  "The Rip",
  "Nirvanna",
  "How to Make a Killing",
  "undertone",
  "Project Hail Mary",
  "Crime 101",
  "The Drama",
  "The Devil Wears Prada 2",
  "Hokum",
  "Obsession",
  "Backrooms",
  "Disclosure Day",
  "Toy Story 5",
  "Tuner",
  "The Invite",
  "The Odyssey",
  "Her Private Hell",
  "Blue Heron",
  "The Dink",
  "Union County",
  "Cookie Queens",
  "The Wrong Girls",
  "Tony",
  "Camp Miasma",
  "Buddy",
  "Coyote vs. Acme",
  "Resident Evil",
  "Bad Apples",
  "Primetime",
  "Digger",
  "The History of Concrete",
  "One Night Only",
  "You Can See Everything"
];

const $ = (selector) => document.querySelector(selector);

function newMovies(titles = DEFAULT_TITLES) {
  return titles.map((title, index) => ({
    id: `movie-${index + 1}`,
    title: title.trim(),
    rating: STARTING_RATING,
    games: 0
  })).filter(movie => movie.title);
}

function validState(value) {
  return value &&
    Array.isArray(value.movies) &&
    value.movies.length >= 2 &&
    Array.isArray(value.history) &&
    value.movies.every(movie =>
      typeof movie.id === "string" &&
      typeof movie.title === "string" &&
      Number.isFinite(movie.rating) &&
      Number.isFinite(movie.games)
    );
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);

    if (raw) {
      const parsed = JSON.parse(raw);

      if (validState(parsed)) {
        return {
          movies: parsed.movies,
          history: parsed.history,
          currentPair: parsed.currentPair || null,
          started: parsed.started === true && Array.isArray(parsed.selectedTitles),
          selectedTitles: parsed.selectedTitles ||
            parsed.movies.map(movie => movie.title)
        };
      }
    }
  } catch (error) {
    console.warn("Could not load saved rankings:", error);
  }

  return {
    movies: newMovies(),
    history: [],
    currentPair: null,
    started: false,
    selectedTitles: [...DEFAULT_TITLES]
  };
}

let state = loadState();
let activeTab = "vote";
let toastTimer;
let selectionOpen = !state.started;
let draftSelection = new Set(state.selectedTitles);

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    $("#save-status").textContent = "Saved locally";
  } catch (error) {
    console.error("Could not save rankings:", error);
    $("#save-status").textContent = "Save failed";
    showToast("Could not save. Export your rankings as a backup.");
  }
}

function getMovie(id) {
  return state.movies.find(movie => movie.id === id);
}

function expectedScore(ratingA, ratingB) {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

function getPairKey(a, b) {
  return [a, b].sort().join("::");
}

/*
 * Adaptive pairing:
 * - Prefer movies with close ratings.
 * - Give under-compared movies extra attention.
 * - Reduce the chance of repeating recent pairs.
 * - Keep older pairs eligible so the ranking can be refined.
 */
function chooseNextPair() {
  const movies = state.movies;
  if (movies.length < 2) return null;

  const recentKeys = new Set(
    state.history.slice(-8).map(v => getPairKey(v.winnerId, v.loserId))
  );

  const candidates = [];

  for (let i = 0; i < movies.length; i++) {
    for (let j = i + 1; j < movies.length; j++) {
      const a = movies[i];
      const b = movies[j];
      const key = getPairKey(a.id, b.id);
      const gap = Math.abs(a.rating - b.rating);
      const leastPlayed = Math.min(a.games, b.games);

      const closeness = 0.25 + 1 / (1 + gap / 180);
      const exploration = 1 + 2.5 / (1 + leastPlayed);
      const recentPenalty = recentKeys.has(key) ? 0.12 : 1;

      candidates.push({
        a: a.id,
        b: b.id,
        weight: closeness * exploration * recentPenalty
      });
    }
  }

  if (!candidates.length) return null;

  // Weighted random selection adds variety among useful matchups.
  const totalWeight = candidates.reduce((sum, pair) => sum + pair.weight, 0);
  let draw = Math.random() * totalWeight;

  for (const candidate of candidates) {
    draw -= candidate.weight;
    if (draw <= 0) {
      return [candidate.a, candidate.b];
    }
  }

  const last = candidates[candidates.length - 1];
  return [last.a, last.b];
}

function ensureCurrentPair() {
  const pair = state.currentPair;
  if (
    pair &&
    pair.length === 2 &&
    pair[0] !== pair[1] &&
    getMovie(pair[0]) &&
    getMovie(pair[1])
  ) {
    return;
  }
  state.currentPair = chooseNextPair();
}

function recordVote(winnerId, loserId) {
  const winner = getMovie(winnerId);
  const loser = getMovie(loserId);
  if (!winner || !loser || winnerId === loserId) return;

  // Store the exact pre-vote values so Undo reverses the vote precisely.
  const before = {
    [winnerId]: { rating: winner.rating, games: winner.games },
    [loserId]: { rating: loser.rating, games: loser.games }
  };

  const winnerExpected = expectedScore(winner.rating, loser.rating);
  const loserExpected = expectedScore(loser.rating, winner.rating);

  winner.rating += K_FACTOR * (1 - winnerExpected);
  loser.rating += K_FACTOR * (0 - loserExpected);
  winner.games += 1;
  loser.games += 1;

  state.history.push({
    winnerId,
    loserId,
    winnerTitle: winner.title,
    loserTitle: loser.title,
    before,
    timestamp: new Date().toISOString()
  });

  state.currentPair = chooseNextPair();
  saveState();
  render();
  showToast(`${winner.title} ranked above ${loser.title}`);
}

function undoLastVote() {
  const vote = state.history.pop();
  if (!vote) return;

  for (const [id, previous] of Object.entries(vote.before || {})) {
    const movie = getMovie(id);
    if (movie) {
      movie.rating = previous.rating;
      movie.games = previous.games;
    }
  }

  // Restore the pair that was voted on.
  state.currentPair = [vote.winnerId, vote.loserId];
  saveState();
  render();
  showToast("Last vote undone");
}

function sortedMovies() {
  return [...state.movies].sort((a, b) =>
    b.rating - a.rating ||
    b.games - a.games ||
    a.title.localeCompare(b.title)
  );
}

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

function renderSelection() {
  const query = $("#selection-search").value.trim().toLowerCase();
  const selected = draftSelection.size;

  $("#selection-count").textContent =
    `${selected} of ${DEFAULT_TITLES.length} selected`;

  $("#selection-hint").textContent = selected < 2
    ? "Select at least two movies to begin."
    : `${selected} movies ready to rank.`;

  $("#start-ranking-button").disabled = selected < 2;

  $("#movie-selection-list").innerHTML = DEFAULT_TITLES
    .filter(title => title.toLowerCase().includes(query))
    .map(title => `
      <label class="movie-selection-item">
        <input
          type="checkbox"
          data-movie-title="${escapeHTML(title)}"
          ${draftSelection.has(title) ? "checked" : ""}
        >
        <span>${escapeHTML(title)}</span>
      </label>
    `).join("");
}

function openMovieSelection() {
  draftSelection = new Set(state.selectedTitles);
  selectionOpen = true;
  $("#selection-search").value = "";
  render();
}

function startRanking() {
  if (draftSelection.size < 2) {
    showToast("Select at least two movies.");
    return;
  }

  if (state.started && state.history.length > 0) {
    const confirmed = window.confirm(
      "Starting a new ranking will reset the current ELO ratings " +
      "and comparison history. Continue?"
    );

    if (!confirmed) return;
  }

  state.selectedTitles = DEFAULT_TITLES.filter(title =>
    draftSelection.has(title)
  );

  state.movies = newMovies(state.selectedTitles);
  state.history = [];
  state.currentPair = null;
  state.started = true;
  state.currentPair = chooseNextPair();

  selectionOpen = false;
  activeTab = "vote";

  saveState();
  render();
  showToast("Your new movie ranking is ready!");
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function renderMatchup() {
  ensureCurrentPair();
  const pair = state.currentPair;

  if (!pair) {
    $("#left-title").textContent = "Add more movies";
    $("#right-title").textContent = "Add more movies";
    return;
  }

  $("#left-title").textContent = getMovie(pair[0]).title;
  $("#right-title").textContent = getMovie(pair[1]).title;

  $("#vote-count").textContent =
    `${state.history.length} comparison${state.history.length === 1 ? "" : "s"}`;

  $("#undo-button").disabled = state.history.length === 0;

  const mostPlayed = [...state.movies].sort((a, b) => b.games - a.games)[0];
  $("#most-compared").textContent =
    mostPlayed && mostPlayed.games > 0 ? mostPlayed.title : "—";
  $("#movie-count").textContent = state.movies.length;
  $("#total-votes").textContent = state.history.length;

  $("#matchup-hint").textContent = state.history.length === 0
    ? "No wrong answers. Go with your gut."
    : "Your choices are shaping the leaderboard.";
}

function renderRankings() {
  const query = $("#search-input").value.trim().toLowerCase();
  const all = sortedMovies();
  const filtered = all.filter(movie => movie.title.toLowerCase().includes(query));

  $("#ranking-rows").innerHTML = filtered.map(movie => {
    const rank = all.findIndex(item => item.id === movie.id) + 1;
    return `
      <tr>
        <td class="rank-number ${rank <= 3 ? "rank-top" : ""}">${rank}</td>
        <td class="movie-cell">${escapeHTML(movie.title)}</td>
        <td class="numeric rating">${movie.rating.toFixed(1)}</td>
        <td class="numeric">${movie.games}</td>
      </tr>`;
  }).join("");

  if (filtered.length === 0) {
    $("#ranking-rows").innerHTML =
      '<tr><td colspan="4">No movies match your search.</td></tr>';
  }
}

function renderHistory() {
  const list = $("#history-list");
  const empty = $("#empty-history");
  const recent = [...state.history].reverse();

  empty.classList.toggle("hidden", recent.length !== 0);

  list.innerHTML = recent.map((vote, index) => `
    <div class="history-item">
      <div class="history-choice">
        <span class="history-winner">${escapeHTML(vote.winnerTitle)}</span>
        <span class="history-vs">beat</span>
        <span class="history-loser">${escapeHTML(vote.loserTitle)}</span>
      </div>
      <span class="history-meta">${escapeHTML(formatDate(vote.timestamp))}</span>
    </div>
  `).join("");
}

function render() {
  renderSelection();
  renderMatchup();
  renderRankings();
  renderHistory();

  $("#selection-panel").classList.toggle(
    "hidden", !selectionOpen
  );

  document.querySelector(".tabs").classList.toggle(
    "hidden", selectionOpen
  );

  $("#vote-panel").classList.toggle(
    "hidden", selectionOpen || activeTab !== "vote"
  );

  $("#rankings-panel").classList.toggle(
    "hidden", selectionOpen || activeTab !== "rankings"
  );

  $("#history-panel").classList.toggle(
    "hidden", selectionOpen || activeTab !== "history"
  );

  document.querySelectorAll("[data-tab]").forEach(button => {
    const active = button.dataset.tab === activeTab;
    button.classList.toggle("active", active);
    button.setAttribute("aria-current", active ? "page" : "false");
  });
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("visible"), 2300);
}

function csvCell(value) {
  let text = String(value ?? "");

  // Prevent spreadsheet programs from treating imported text as formulas.
  if (/^[\s]*[=+\-@]/.test(text)) text = "'" + text;

  return '"' + text.replace(/"/g, '""') + '"';
}

function downloadCSV(filename, rows) {
  const csv = "\uFEFF" + rows.map(row => row.map(csvCell).join(",")).join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();

  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast(`${filename} downloaded`);
}

function exportRankings() {
  const rows = [
    ["Rank", "Movie", "Elo Rating", "Matchups"],
    ...sortedMovies().map((movie, index) => [
      index + 1,
      movie.title,
      movie.rating.toFixed(2),
      movie.games
    ])
  ];
  downloadCSV("movie-rankings.csv", rows);
}

function exportHistory() {
  const rows = [
    ["Vote", "Timestamp", "Preferred Movie", "Other Movie"],
    ...state.history.map((vote, index) => [
      index + 1,
      vote.timestamp,
      vote.winnerTitle,
      vote.loserTitle
    ])
  ];
  downloadCSV("movie-match-history.csv", rows);
}

function resetRankings() {
  const confirmed = window.confirm(
    "Reset all ratings and votes? This will erase the saved ranking history in this browser."
  );
  if (!confirmed) return;

  state = {
    movies: newMovies(state.selectedTitles),
    history: [],
    currentPair: null,
    started: true,
    selectedTitles: [...state.selectedTitles]
  };
  state.currentPair = chooseNextPair();
  saveState();
  render();
  showToast("Rankings reset");
}

// Navigation
document.querySelectorAll("[data-tab]").forEach(button => {
  button.addEventListener("click", () => {
    activeTab = button.dataset.tab;
    render();
  });
});

// Matchup cards use delegated click handling.
$("#matchup").addEventListener("click", event => {
  const button = event.target.closest('[data-action="choose"]');
  if (!button || !state.currentPair) return;

  const [leftId, rightId] = state.currentPair;
  const winnerId = button.dataset.side === "left" ? leftId : rightId;
  const loserId = button.dataset.side === "left" ? rightId : leftId;

  recordVote(winnerId, loserId);
});

$("#skip-button").addEventListener("click", () => {
  state.currentPair = chooseNextPair();
  saveState();
  renderMatchup();
});

$("#undo-button").addEventListener("click", undoLastVote);
$("#export-ranking-button").addEventListener("click", exportRankings);
$("#export-ranking-button-2").addEventListener("click", exportRankings);
$("#export-history-button").addEventListener("click", exportHistory);
$("#reset-button").addEventListener("click", resetRankings);
$("#search-input").addEventListener("input", renderRankings);

$("#selection-search").addEventListener("input", () => {
  renderSelection();
});

$("#movie-selection-list").addEventListener("change", event => {
  const checkbox = event.target.closest('input[type="checkbox"]');
  if (!checkbox) return;

  const title = checkbox.dataset.movieTitle;

  if (checkbox.checked) {
    draftSelection.add(title);
  } else {
    draftSelection.delete(title);
  }

  renderSelection();
});

$("#select-all-button").addEventListener("click", () => {
  draftSelection = new Set(DEFAULT_TITLES);
  renderSelection();
});

$("#clear-selection-button").addEventListener("click", () => {
  draftSelection.clear();
  renderSelection();
});

$("#start-ranking-button").addEventListener("click", startRanking);
$("#change-selection-button").addEventListener("click", openMovieSelection);

// Only initialize a matchup after the user starts ranking.
if (state.started) {
  ensureCurrentPair();
}

render();
