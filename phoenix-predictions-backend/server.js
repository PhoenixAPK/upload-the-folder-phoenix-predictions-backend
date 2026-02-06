import express from "express";
import cors from "cors";
import NodeCache from "node-cache";

const app = express();
app.use(cors());
app.use(express.json());

// Secrets MUST be provided as Render environment variables later.
const API_FOOTBALL_KEY = process.env.API_FOOTBALL_KEY || "";
const FOOTBALL_DATA_KEY = process.env.FOOTBALL_DATA_KEY || "";

const TZ = process.env.TZ || "Africa/Casablanca";
const PORT = process.env.PORT || 10000;

// 1 hour cache
const cache = new NodeCache({ stdTTL: 60 * 60, checkperiod: 120 });

// ---------- Time helpers (Morocco time) ----------
function isoDateInTz(date, tz) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const y = parts.find((p) => p.type === "year").value;
  const m = parts.find((p) => p.type === "month").value;
  const d = parts.find((p) => p.type === "day").value;
  return `${y}-${m}-${d}`;
}

function nowIso() {
  return new Date().toISOString();
}

// ---------- Demo fallback (works without keys) ----------
function demoPayload() {
  const serverDate = isoDateInTz(new Date(), TZ);
  return {
    serverDate,
    serverTime: nowIso(),
    timeZone: TZ,
    leagues: [
      {
        name: "Demo League",
        country: "Demo",
        matches: [],
      },
    ],
  };
}

// ---------- Prediction logic (same as frontend rules) ----------
const avg = (arr) => arr.reduce((a, b) => a + b, 0) / (arr.length || 1);

function weightedForm(last10) {
  const last5 = last10.slice(0, 5);
  const prev5 = last10.slice(5, 10);
  const scored = avg(last5.map((m) => m.gf)) * 0.6 + avg(prev5.map((m) => m.gf)) * 0.4;
  const conceded = avg(last5.map((m) => m.ga)) * 0.6 + avg(prev5.map((m) => m.ga)) * 0.4;
  return { scored, conceded };
}

function attackersPenalty(n) {
  if (!n) return 0;
  if (n === 1) return 0.15;
  if (n === 2) return 0.3;
  return 0.45;
}

function defendersBoost(n) {
  if (!n) return 0;
  if (n === 1) return 0.15;
  if (n === 2) return 0.3;
  return 0.45;
}

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

function applySquadImpact(EH, EA, homeSquad, awaySquad) {
  let adjH = 0;
  let adjA = 0;

  adjH -= attackersPenalty(homeSquad.attackMissing || 0);
  adjA -= attackersPenalty(awaySquad.attackMissing || 0);

  adjH += defendersBoost(awaySquad.defMissing || 0);
  adjA += defendersBoost(homeSquad.defMissing || 0);

  if (homeSquad.topScorerMissing) adjH -= 0.2;
  if (awaySquad.topScorerMissing) adjA -= 0.2;

  adjH = clamp(adjH, -0.6, 0.6);
  adjA = clamp(adjA, -0.6, 0.6);

  return { EH: EH + adjH, EA: EA + adjA, adjH, adjA };
}

function roundEG(x) {
  if (x < 0.2) return 0;
  if (x >= 3.8) return 4;
  return Math.round(x);
}

function wdlPercents(D) {
  if (D >= 0.6) return { home: 65, draw: 25, away: 10 };
  if (D >= 0.2) return { home: 52, draw: 30, away: 18 };
  if (D > -0.2) return { home: 33, draw: 34, away: 33 };
  if (D > -0.6) return { home: 18, draw: 30, away: 52 };
  return { home: 10, draw: 25, away: 65 };
}

function confidence(homeSquad, awaySquad) {
  const missing =
    (homeSquad.attackMissing || 0) +
    (homeSquad.defMissing || 0) +
    (awaySquad.attackMissing || 0) +
    (awaySquad.defMissing || 0) +
    (homeSquad.topScorerMissing ? 1 : 0) +
    (awaySquad.topScorerMissing ? 1 : 0);

  if (missing === 0) return "High";
  if (missing <= 2) return "Medium";
  return "Low";
}

function totals(last10) {
  const gf = last10.reduce((s, m) => s + m.gf, 0);
  const ga = last10.reduce((s, m) => s + m.ga, 0);
  return { gf, ga };
}

function computePrediction(homeLast10, awayLast10, homeSquad, awaySquad) {
  const hf = weightedForm(homeLast10);
  const af = weightedForm(awayLast10);

  let expectedHome = (hf.scored + af.conceded) / 2;
  let expectedAway = (af.scored + hf.conceded) / 2;

  const adj = applySquadImpact(expectedHome, expectedAway, homeSquad, awaySquad);
  expectedHome = adj.EH;
  expectedAway = adj.EA;

  const expectedTotal = expectedHome + expectedAway;
  const D = expectedHome - expectedAway;

  return {
    expectedHome,
    expectedAway,
    expectedTotal,
    predictedScore: `${roundEG(expectedHome)} - ${roundEG(expectedAway)}`,
    wdl: wdlPercents(D),
    confidence: confidence(homeSquad, awaySquad),
    adjustments: adj,
    homeTotals: totals(homeLast10),
    awayTotals: totals(awayLast10),
  };
}

// ---------- External API wrappers (keys required) ----------
async function fetchJson(url, headers = {}) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return await res.json();
}

// API-Football base
const AF_BASE = "https://v3.football.api-sports.io";

async function apiFootballToday(serverDate) {
  // Global fixtures for date
  return fetchJson(`${AF_BASE}/fixtures?date=${serverDate}`, {
    "x-apisports-key": API_FOOTBALL_KEY,
  });
}

async function apiFootballLast10(teamId) {
  return fetchJson(`${AF_BASE}/fixtures?team=${teamId}&last=10`, {
    "x-apisports-key": API_FOOTBALL_KEY,
  });
}

async function apiFootballInjuriesByFixture(fixtureId) {
  return fetchJson(`${AF_BASE}/injuries?fixture=${fixtureId}`, {
    "x-apisports-key": API_FOOTBALL_KEY,
  });
}

async function apiFootballTopScorersByLeague(leagueId, season) {
  return fetchJson(`${AF_BASE}/players/topscorers?league=${leagueId}&season=${season}`, {
    "x-apisports-key": API_FOOTBALL_KEY,
  });
}

function mapLast10(fixturesJson, teamId) {
  const arr = (fixturesJson?.response || []).slice(0, 10).map((f) => {
    const homeId = f.teams.home.id;
    const isHome = homeId === teamId;
    const gf = isHome ? f.goals.home : f.goals.away;
    const ga = isHome ? f.goals.away : f.goals.home;
    const r = gf > ga ? "W" : gf < ga ? "L" : "D";
    return { gf: Number(gf ?? 0), ga: Number(ga ?? 0), r };
  });
  // Ensure length 10
  while (arr.length < 10) arr.push({ gf: 0, ga: 0, r: "D" });
  return arr;
}

function deriveSquadFromInjuries(injJson, teamId) {
  const list = (injJson?.response || []).filter((x) => x.team?.id === teamId);
  const missingNames = list.slice(0, 5).map((x) => `${x.player?.name || "Player"} (${x.type || "out"})`);

  // Attempt to classify positions
  let attackMissing = 0;
  let defMissing = 0;
  let topScorerMissing = false;

  for (const item of list) {
    const pos = (item.player?.position || "").toLowerCase();
    if (pos.includes("forward") || pos.includes("attacker") || pos.includes("striker") || pos.includes("wing")) attackMissing++;
    if (pos.includes("defender") || pos.includes("goalkeeper") || pos.includes("keeper") || pos.includes("cb") || pos.includes("lb") || pos.includes("rb")) defMissing++;
  }

  const squadStatus = list.length ? `${list.length} missing` : "Full squad";

  return {
    squadStatus,
    missingNames,
    attackMissing: clamp(attackMissing, 0, 3),
    defMissing: clamp(defMissing, 0, 3),
    topScorerMissing,
  };
}

function pickTeamTopScorer(topScorersJson, teamId) {
  const players = (topScorersJson?.response || []).filter((p) => p.statistics?.[0]?.team?.id === teamId);
  if (!players.length) return { name: "—", goals: "—" };
  const best = players[0];
  const goals = best.statistics?.[0]?.goals?.total ?? "—";
  return { name: best.player?.name || "—", goals };
}

function groupByLeague(fixturesJson) {
  const out = new Map();
  for (const f of fixturesJson.response || []) {
    const leagueName = f.league?.name || "Unknown League";
    const country = f.league?.country || "";
    const key = `${leagueName}||${country}`;
    if (!out.has(key)) out.set(key, { name: leagueName, country, matches: [] });

    const kickoff = (f.fixture?.date || "").slice(11, 16) || "--:--";
    const statusShort = f.fixture?.status?.short || "NS";
    const status = statusShort === "LIVE" || statusShort === "1H" || statusShort === "2H" ? "LIVE" :
                   statusShort === "FT" || statusShort === "AET" || statusShort === "PEN" ? "FINISHED" : "UPCOMING";

    out.get(key).matches.push({
      id: String(f.fixture?.id),
      kickoff,
      status,
      homeName: f.teams?.home?.name || "Home",
      awayName: f.teams?.away?.name || "Away",
      api: {
        fixtureId: f.fixture?.id,
        leagueId: f.league?.id,
        season: f.league?.season,
        homeTeamId: f.teams?.home?.id,
        awayTeamId: f.teams?.away?.id,
      },
    });
  }
  return [...out.values()];
}

// ---------- Routes ----------
app.get("/health", (req, res) => {
  res.json({ ok: true, serverTime: nowIso(), tz: TZ });
});

app.get("/today", async (req, res) => {
  const serverDate = isoDateInTz(new Date(), TZ);

  const cached = cache.get(`today:${serverDate}`);
  if (cached) return res.json(cached);

  // If no keys, return demo payload
  if (!API_FOOTBALL_KEY) {
    const payload = demoPayload();
    cache.set(`today:${serverDate}`, payload);
    return res.json(payload);
  }

  try {
    const fixtures = await apiFootballToday(serverDate);
    const leagues = groupByLeague(fixtures);

    // Enrich each match with last10, injuries, top scorers, and computed prediction
    for (const lg of leagues) {
      for (const m of lg.matches) {
        const { fixtureId, leagueId, season, homeTeamId, awayTeamId } = m.api;

        const [homeLast10Json, awayLast10Json, injJson, topScorersJson] = await Promise.all([
          apiFootballLast10(homeTeamId),
          apiFootballLast10(awayTeamId),
          apiFootballInjuriesByFixture(fixtureId),
          leagueId && season ? apiFootballTopScorersByLeague(leagueId, season) : Promise.resolve({ response: [] }),
        ]);

        const homeLast10 = mapLast10(homeLast10Json, homeTeamId);
        const awayLast10 = mapLast10(awayLast10Json, awayTeamId);

        const homeSquad = deriveSquadFromInjuries(injJson, homeTeamId);
        const awaySquad = deriveSquadFromInjuries(injJson, awayTeamId);

        const topScorerHome = pickTeamTopScorer(topScorersJson, homeTeamId);
        const topScorerAway = pickTeamTopScorer(topScorersJson, awayTeamId);

        // mark top scorer missing if present in missing list
        if (homeSquad.missingNames.some((x) => String(x).includes(String(topScorerHome.name)))) homeSquad.topScorerMissing = true;
        if (awaySquad.missingNames.some((x) => String(x).includes(String(topScorerAway.name)))) awaySquad.topScorerMissing = true;

        const prediction = computePrediction(homeLast10, awayLast10, homeSquad, awaySquad);

        // Structure to match frontend expectations
        m.home = { name: m.homeName, last10: homeLast10, squad: homeSquad };
        m.away = { name: m.awayName, last10: awayLast10, squad: awaySquad };
        m.topScorerHome = topScorerHome;
        m.topScorerAway = topScorerAway;

        // These fields are optional for UI; frontend will compute too, but we include them for consistency
        m.prediction = prediction;

        delete m.api;
      }
    }

    const payload = { serverDate, serverTime: nowIso(), timeZone: TZ, leagues };
    cache.set(`today:${serverDate}`, payload);
    res.json(payload);
  } catch (e) {
    // Fallback to demo
    const payload = demoPayload();
    payload.error = "backend_fetch_failed";
    cache.set(`today:${serverDate}`, payload);
    res.json(payload);
  }
});

app.listen(PORT, () => {
  console.log(`Phoenix Predictions backend running on port ${PORT}`);
});
