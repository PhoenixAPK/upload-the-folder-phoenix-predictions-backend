const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 10000;

// Allow your GitHub Pages frontend to call this API
app.use(cors({
  origin: "https://phoenixapk.github.io"
}));

// Replace this with your actual football API key
const FOOTBALL_API_KEY = "bb93c13755634111b3283c42aa3a64b8";
const FOOTBALL_API_BASE = "https://api.football-data.org/v4";

app.get("/matches/today", async (req, res) => {
  try {
    // Fetch matches for today
    const today = new Date();
    const dateStr = today.toISOString().split("T")[0]; // YYYY-MM-DD
    const response = await axios.get(`${FOOTBALL_API_BASE}/matches?dateFrom=${dateStr}&dateTo=${dateStr}`, {
      headers: { "X-Auth-Token": FOOTBALL_API_KEY }
    });

    // Transform data to only what frontend needs
    const matches = response.data.matches.map(m => ({
      id: m.id,
      league: m.competition.name,
      homeTeam: m.homeTeam.name,
      awayTeam: m.awayTeam.name,
      homeScore: m.score.fullTime.home ?? null,
      awayScore: m.score.fullTime.away ?? null,
      status: m.status
    }));

    res.json(matches);
  } catch (err) {
    console.error("Error fetching matches:", err.message);
    res.status(500).json({ error: "Failed to fetch matches" });
  }
});

// Example endpoint for team stats
app.get("/team/:teamId/stats", async (req, res) => {
  try {
    const teamId = req.params.teamId;

    // Fetch last 10 matches for team
    const response = await axios.get(`${FOOTBALL_API_BASE}/teams/${teamId}/matches?limit=10`, {
      headers: { "X-Auth-Token": FOOTBALL_API_KEY }
    });

    const matches = response.data.matches;

    const totalScored = matches.reduce((sum, m) => sum + (m.homeTeam.id === parseInt(teamId) ? m.score.fullTime.home : m.score.fullTime.away || 0), 0);
    const totalConceded = matches.reduce((sum, m) => sum + (m.homeTeam.id === parseInt(teamId) ? m.score.fullTime.away : m.score.fullTime.home || 0), 0);

    const averageScored = totalScored / matches.length;
    const averageConceded = totalConceded / matches.length;

    res.json({
      totalScored,
      totalConceded,
      averageScored,
      averageConceded,
      last10Matches: matches
    });
  } catch (err) {
    console.error("Error fetching team stats:", err.message);
    res.status(500).json({ error: "Failed to fetch team stats" });
  }
});

app.listen(PORT, () => {
  console.log(`Phoenix Predictions backend running on port ${PORT}`);
});
