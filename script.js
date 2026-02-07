// ==========================
// Phoenix Predictions Script
// ==========================

// Set your Render backend URL
const API_BASE = "https://upload-the-folder-phoenix-predictions.onrender.com";

const listEl = document.getElementById("list");
const cacheChip = document.getElementById("cacheChip");
const refreshBtn = document.getElementById("refreshBtn");
const sourceBtn = document.getElementById("sourceBtn");
const searchInput = document.getElementById("search");
const dateLine = document.getElementById("dateLine");

let matchesData = [];

// Format Moroccan date
function formatMoroccoDate(iso) {
  return new Date(iso).toLocaleString("en-GB", {
    timeZone: "Africa/Casablanca",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Fetch matches from backend
async function fetchMatches() {
  try {
    listEl.innerHTML = "Loading matches...";
    const res = await fetch(`${API_BASE}/today`);
    const data = await res.json();

    matchesData = data.leagues.flatMap(l => l.matches || []);
    updateCacheInfo(data);

    renderMatches(matchesData);
  } catch (err) {
    console.error(err);
    listEl.innerHTML = "Failed to load matches.";
  }
}

// Update cache info and date line
function updateCacheInfo(data) {
  const serverDate = new Date(data.serverDate + "T" + data.serverTime);
  dateLine.textContent = formatMoroccoDate(serverDate);
  cacheChip.textContent = `Cache: ${new Date().toLocaleTimeString("en-GB", { timeZone: "Africa/Casablanca" })}`;
}

// Render matches in the list
function renderMatches(matches) {
  listEl.innerHTML = "";

  if (!matches.length) {
    listEl.innerHTML = "<p>No matches found today.</p>";
    return;
  }

  matches.forEach(match => {
    const div = document.createElement("div");
    div.className = "match";

    // Compute totals & averages
    const homeStats = computeTeamStats(match.homeTeam);
    const awayStats = computeTeamStats(match.awayTeam);

    div.innerHTML = `
      <div class="time">${match.time}</div>
      <div class="teams">
        <div class="row">
          <div class="team">${match.homeTeam.name}</div>
          <div class="score">${match.homeTeam.score ?? "-"}</div>
        </div>
        <div class="row">
          <div class="team">${match.awayTeam.name}</div>
          <div class="score">${match.awayTeam.score ?? "-"}</div>
        </div>
      </div>
      <div class="pred">
        <div class="predscore">Predicted: ${homeStats.avgScored.toFixed(1)} - ${awayStats.avgScored.toFixed(1)}</div>
        <div class="predlabel">
          Totals (Last 10): H Scored ${homeStats.totalScored}, H Conceded ${homeStats.totalConceded}<br>
          A Scored ${awayStats.totalScored}, A Conceded ${awayStats.totalConceded}
        </div>
      </div>
    `;

    listEl.appendChild(div);
  });
}

// Compute totals and averages for last 10 games
function computeTeamStats(team) {
  const lastGames = team.last10Games || [];
  const totalScored = lastGames.reduce((sum, g) => sum + (g.scored || 0), 0);
  const totalConceded = lastGames.reduce((sum, g) => sum + (g.conceded || 0), 0);
  const avgScored = lastGames.length ? totalScored / lastGames.length : 0;
  const avgConceded = lastGames.length ? totalConceded / lastGames.length : 0;
  return { totalScored, totalConceded, avgScored, avgConceded };
}

// Filter matches by search
searchInput.addEventListener("input", () => {
  const term = searchInput.value.toLowerCase();
  const filtered = matchesData.filter(m =>
    m.homeTeam.name.toLowerCase().includes(term) ||
    m.awayTeam.name.toLowerCase().includes(term) ||
    (m.leagueName || "").toLowerCase().includes(term)
  );
  renderMatches(filtered);
});

// Refresh button
refreshBtn.addEventListener("click", fetchMatches);

// Initialize
fetchMatches();
