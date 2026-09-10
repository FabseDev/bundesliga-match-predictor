// Serverless Bundesliga-Predictions mit dynamischen ELO-Ratings + Poisson Score-Modell

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 Stunde: Fixture-Cache
let fixturesCache = { ts: 0, data: null };

// Separater Cache für ELO-Werte
const ELO_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 Stunden
let eloCache = {}; // { teamName: { ts, elo } }

// Mapping football-data.org Teamnamen -> ClubElo URLs
const ELO_URLS = {
  "FC Bayern München": "https://clubelo.com/BayernMunich",
  "Borussia Dortmund": "https://clubelo.com/Dortmund",
  "Bayer 04 Leverkusen": "https://clubelo.com/Leverkusen",
  "RB Leipzig": "https://clubelo.com/RBLeipzig",
  "VfB Stuttgart": "https://clubelo.com/Stuttgart",
  "Eintracht Frankfurt": "https://clubelo.com/Frankfurt",
  "SC Freiburg": "https://clubelo.com/Freiburg",
  "TSG 1899 Hoffenheim": "https://clubelo.com/Hoffenheim",
  "1. FC Union Berlin": "https://clubelo.com/UnionBerlin",
  "VfL Wolfsburg": "https://clubelo.com/Wolfsburg",
  "SV Werder Bremen": "https://clubelo.com/WerderBremen",
  "1. FSV Mainz 05": "https://clubelo.com/Mainz",
  "Borussia Mönchengladbach": "https://clubelo.com/MGladbach",
  "FC Augsburg": "https://clubelo.com/Augsburg",
  "VfL Bochum 1848": "https://clubelo.com/Bochum",
  "1. FC Heidenheim 1846": "https://clubelo.com/Heidenheim",
  "SV Darmstadt 98": "https://clubelo.com/Darmstadt",
  "1. FC Köln": "https://clubelo.com/Cologne"
};

// ClubElo HTML scrapen
async function fetchElo(url) {
  const res = await fetch(url);
  const html = await res.text();
  const match = html.match(/<td>(\d{3,4})<\/td>/);
  return match ? parseInt(match[1], 10) : 1500;
}

// ELO mit Cache
async function getTeamElo(teamName) {
  const now = Date.now();
  const cached = eloCache[teamName];

  if (cached && now - cached.ts < ELO_CACHE_TTL_MS) {
    return cached.elo;
  }

  const url = ELO_URLS[teamName];
  if (!url) {
    eloCache[teamName] = { ts: now, elo: 1500 };
    return 1500;
  }

  try {
    const elo = await fetchElo(url);
    eloCache[teamName] = { ts: now, elo };
    return elo;
  } catch {
    eloCache[teamName] = { ts: now, elo: 1500 };
    return 1500;
  }
}

// Poisson-Verteilung
function poisson(lambda, goals) {
  return (Math.pow(lambda, goals) * Math.exp(-lambda)) / factorial(goals);
}

function factorial(n) {
  return n <= 1 ? 1 : n * factorial(n - 1);
}

// ELO → erwartete Tore (xG)
function expectedGoals(homeElo, awayElo) {
  const diff = homeElo - awayElo + 50; // Heimvorteil
  const homeExp = 1.4 + diff / 400;    // Basis + ELO-Effekt
  const awayExp = 1.2 - diff / 400;
  return {
    home: Math.max(0.2, homeExp),
    away: Math.max(0.2, awayExp)
  };
}

// Score-Wahrscheinlichkeiten berechnen
function poissonScorePrediction(homeElo, awayElo) {
  const { home, away } = expectedGoals(homeElo, awayElo);

  let bestScore = "1:1";
  let bestProb = 0;

  const maxGoals = 6;

  for (let h = 0; h <= maxGoals; h++) {
    for (let a = 0; a <= maxGoals; a++) {
      const p = poisson(home, h) * poisson(away, a);
      if (p > bestProb) {
        bestProb = p;
        bestScore = `${h}:${a}`;
      }
    }
  }

  return {
    prediction: bestScore,
    confidence: Math.round(bestProb * 1000) / 1000
  };
}

module.exports = async (req, res) => {
  try {
    const now = Date.now();

    if (fixturesCache.data && now - fixturesCache.ts < CACHE_TTL_MS) {
      return res.status(200).json({ source: "cache", matches: fixturesCache.data });
    }

    const API_TOKEN = process.env.FOOTBALL_DATA_API_TOKEN;
    if (!API_TOKEN) {
      return res.status(500).json({ error: "Missing FOOTBALL_DATA_API_TOKEN" });
    }

    const url = "https://api.football-data.org/v4/competitions/BL1/matches?status=SCHEDULED";

    const fetchRes = await fetch(url, {
      headers: { "X-Auth-Token": API_TOKEN }
    });

    const payload = await fetchRes.json();
    const matches = payload.matches || [];

    const fixtures = [];

    for (const m of matches) {
      const home = m.homeTeam?.name ?? "Home";
      const away = m.awayTeam?.name ?? "Away";
      const utc = m.utcDate || new Date().toISOString();

      const [homeElo, awayElo] = await Promise.all([
        getTeamElo(home),
        getTeamElo(away)
      ]);

      const pred = poissonScorePrediction(homeElo, awayElo);

      fixtures.push({
        id: m.id || `${home}-${away}-${utc}`,
        date: utc.slice(0, 10),
        time: utc.slice(11, 16),
        homeTeam: home,
        awayTeam: away,
        homeElo,
        awayElo,
        prediction: pred.prediction,
        confidence: pred.confidence
      });
    }

    fixturesCache = { ts: now, data: fixtures };
    return res.status(200).json({ source: "api", matches: fixtures });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
