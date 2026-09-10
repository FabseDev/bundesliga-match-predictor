// Serverless Bundesliga-Predictions mit:
// - football-data.org (Fixtures)
// - ClubElo (dynamische ELO-Ratings, gescraped)
// - optional Buchmacher-Quoten (TheOddsAPI o.ä.)
// - sauberes Modell: ELO + Quoten -> 1X2-Probs -> erwartete Tore (λ) -> Poisson -> wahrscheinlichstes Ergebnis
//
// ENV-Variablen (alle NUR als Umgebungsvariablen, nicht im Code hart codieren):
// - FOOTBALL_DATA_API_TOKEN  (für football-data.org)
// - ODDS_API_KEY             (für Quoten-API; wenn nicht gesetzt, läuft Modell nur mit ELO)

const CACHE_TTL_MS = 60 * 60 * 1000; // 1h: Fixture-Cache
let fixturesCache = { ts: 0, data: null };

const ELO_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h: ELO-Cache
let eloCache = {}; // { teamName: { ts, elo } }

const ODDS_CACHE_TTL_MS = 15 * 60 * 1000; // 15min: Quoten-Cache
let oddsCache = {}; // { matchKey: { ts, probs } }

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

// ---------- ELO-Fetch & Cache ----------

async function fetchElo(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ELO fetch failed: ${res.status}`);
  const html = await res.text();

  const match = html.match(/<td>(\d{3,4})<\/td>/);
  if (!match) throw new Error("ELO value not found in HTML");
  return parseInt(match[1], 10);
}

async function getTeamElo(teamName) {
  const now = Date.now();
  const cached = eloCache[teamName];

  if (cached && now - cached.ts < ELO_CACHE_TTL_MS) {
    return cached.elo;
  }

  const url = ELO_URLS[teamName];
  if (!url) {
    const fallback = 1500;
    eloCache[teamName] = { ts: now, elo: fallback };
    return fallback;
  }

  try {
    const elo = await fetchElo(url);
    eloCache[teamName] = { ts: now, elo };
    return elo;
  } catch (e) {
    console.error(`ELO fetch error for ${teamName}:`, e.message);
    const fallback = 1500;
    eloCache[teamName] = { ts: now, elo: fallback };
    return fallback;
  }
}

// ---------- Quoten-Fetch & Cache ----------

function probFromOdds(odds) {
  if (!odds || odds <= 1.0) return 0;
  return 1 / odds;
}

async function fetchOddsForMatch(home, away) {
  const ODDS_API_KEY = process.env.ODDS_API_KEY;
  if (!ODDS_API_KEY) return null;

  const url = `https://api.the-odds-api.com/v4/sports/soccer_germany_bundesliga/odds/?apiKey=${ODDS_API_KEY}&regions=eu&markets=h2h`;

  const res = await fetch(url);
  if (!res.ok) {
    console.error("Odds fetch failed:", res.status);
    return null;
  }

  const data = await res.json();

  const match = data.find(m => {
    const teams = [m.home_team, m.away_team];
    return teams.includes(home) && teams.includes(away);
  });

  if (!match || !match.bookmakers || !match.bookmakers.length) return null;

  const market = match.bookmakers[0].markets.find(m => m.key === "h2h");
  if (!market) return null;

  const outcomes = market.outcomes;
  let homeOdds, drawOdds, awayOdds;

  for (const o of outcomes) {
    if (o.name === match.home_team) homeOdds = o.price;
    else if (o.name === match.away_team) awayOdds = o.price;
    else if (o.name.toLowerCase() === "draw") drawOdds = o.price;
  }

  if (!homeOdds || !awayOdds || !drawOdds) return null;

  let pHome = probFromOdds(homeOdds);
  let pDraw = probFromOdds(drawOdds);
  let pAway = probFromOdds(awayOdds);

  const total = pHome + pDraw + pAway;
  if (total <= 0) return null;

  return {
    home: pHome / total,
    draw: pDraw / total,
    away: pAway / total
  };
}

async function getOddsProbs(home, away, dateKey) {
  const now = Date.now();
  const matchKey = `${home}-${away}-${dateKey}`;
  const cached = oddsCache[matchKey];

  if (cached && now - cached.ts < ODDS_CACHE_TTL_MS) {
    return cached.probs;
  }

  const probs = await fetchOddsForMatch(home, away);
  if (!probs) return null;

  oddsCache[matchKey] = { ts: now, probs };
  return probs;
}

// ---------- ELO-basierte 1X2-Probs ----------

function eloOutcomeProbs(homeElo, awayElo) {
  const homeAdv = 50;
  const diff = homeElo - awayElo + homeAdv;

  const pHome = 1 / (1 + Math.pow(10, -diff / 400));
  const pAway = 1 - pHome;
  const pDraw = 0.22 + (0.1 * Math.exp(-Math.abs(diff) / 200));

  const total = pHome + pDraw + pAway;
  if (total <= 0) {
    return { home: 0.33, draw: 0.34, away: 0.33 };
  }

  return {
    home: pHome / total,
    draw: pDraw / total,
    away: pAway / total
  };
}

// ---------- Kombination ELO + Quoten ----------

function combineProbs(eloProbs, oddsProbs) {
  if (!oddsProbs) return eloProbs;

  const wElo = 0.5;
  const wOdds = 0.5;

  let home = wElo * eloProbs.home + wOdds * oddsProbs.home;
  let draw = wElo * eloProbs.draw + wOdds * oddsProbs.draw;
  let away = wElo * eloProbs.away + wOdds * oddsProbs.away;

  const total = home + draw + away;
  if (total <= 0) {
    return eloProbs;
  }

  home /= total;
  draw /= total;
  away /= total;

  return { home, draw, away };
}

// ---------- 1X2-Probs -> erwartete Tore (λ) ----------

function expectedGoalsFromProbs(probs) {
  const baseHome = 1.4;
  const baseAway = 1.2;

  const strengthDiff = probs.home - probs.away;

  let homeExp = baseHome + strengthDiff * 1.0;
  let awayExp = baseAway - strengthDiff * 1.0;

  homeExp = Math.min(Math.max(homeExp, 0.5), 2.5);
  awayExp = Math.min(Math.max(awayExp, 0.5), 2.5);

  return { home: homeExp, away: awayExp };
}

// ---------- Poisson ----------

function poisson(lambda, goals) {
  if (!Number.isFinite(lambda) || lambda <= 0) return 0;
  if (!Number.isFinite(goals) || goals < 0) return 0;

  return (Math.pow(lambda, goals) * Math.exp(-lambda)) / factorial(goals);
}

function factorial(n) {
  if (!Number.isFinite(n) || n < 0) return NaN;
  n = Math.floor(n);
  let res = 1;
  for (let i = 2; i <= n; i++) res *= i;
  return res;
}

// ---------- Score-Prediction ----------

function poissonScorePredictionFromProbs(combinedProbs) {
  const { home, away } = expectedGoalsFromProbs(combinedProbs);

  let bestScore = "1:1";
  let bestProb = 0;

  const maxGoals = 4;

  for (let h = 0; h <= maxGoals; h++) {
    for (let a = 0; a <= maxGoals; a++) {
      const pHomeGoals = poisson(home, h);
      const pAwayGoals = poisson(away, a);
      const p = pHomeGoals * pAwayGoals;

      if (p > bestProb) {
        bestProb = p;
        bestScore = `${h}:${a}`;
      }
    }
  }

  if (!Number.isFinite(bestProb) || bestProb <= 0) {
    bestProb = 0;
    bestScore = "1:1";
  }

  return {
    prediction: bestScore,
    confidence: Math.round(bestProb * 1000) / 1000
  };
}

// ---------- Haupt-Handler ----------

module.exports = async (req, res) => {
  try {
    const now = Date.now();

    if (fixturesCache.data && now - fixturesCache.ts < CACHE_TTL_MS) {
      return res.status(200).json({ source: "cache", matches: fixturesCache.data });
    }

    const API_TOKEN = process.env.FOOTBALL_DATA_API_TOKEN;
    if (!API_TOKEN) {
      return res.status(500).json({
        error: "Missing FOOTBALL_DATA_API_TOKEN environment variable. Set it in your hosting provider."
      });
    }

    const url = "https://api.football-data.org/v4/competitions/BL1/matches?status=SCHEDULED";

    const fetchRes = await fetch(url, {
      headers: { "X-Auth-Token": API_TOKEN }
    });

    if (!fetchRes.ok) {
      const text = await fetchRes.text();
      return res.status(502).json({ error: "Upstream error", detail: text });
    }

    const payload = await fetchRes.json();
    const matches = payload.matches || [];

    const fixtures = [];

    const nowDate = new Date();
    const cutoffDate = new Date(nowDate.getTime() + 14 * 24 * 60 * 60 * 1000);

    for (const m of matches) {
      const home = m.homeTeam?.name ?? "Home";
      const away = m.awayTeam?.name ?? "Away";
      const utc = m.utcDate || new Date().toISOString();
      const matchDate = new Date(utc);

      if (matchDate > cutoffDate || matchDate < nowDate) {
        continue;
      }

      const dateKey = utc.slice(0, 10);

      const [homeElo, awayElo] = await Promise.all([
        getTeamElo(home),
        getTeamElo(away)
      ]);

      const eloProbs = eloOutcomeProbs(homeElo, awayElo);
      const oddsProbs = await getOddsProbs(home, away, dateKey);
      const combinedProbs = combineProbs(eloProbs, oddsProbs);

      const scorePred = poissonScorePredictionFromProbs(combinedProbs);

      fixtures.push({
        id: m.id || `${home}-${away}-${utc}`,
        date: utc.slice(0, 10),
        time: utc.slice(11, 16),
        homeTeam: home,
        awayTeam: away,
        homeElo,
        awayElo,
        prediction: scorePred.prediction,
        confidence: scorePred.confidence,
        probabilities: {
          home: Math.round(combinedProbs.home * 1000) / 1000,
          draw: Math.round(combinedProbs.draw * 1000) / 1000,
          away: Math.round(combinedProbs.away * 1000) / 1000
        },
        eloProbabilities: eloProbs,
        oddsProbabilities: oddsProbs || null
      });
    }

    fixturesCache = { ts: now, data: fixtures };
    return res.status(200).json({ source: "api", matches: fixtures });
  } catch (err) {
    console.error("fixtures error", err);
    return res.status(500).json({ error: err.message });
  }
};
