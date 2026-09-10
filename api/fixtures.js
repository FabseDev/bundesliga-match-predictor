// Serverless Bundesliga-Predictions mit:
// - football-data.org (Fixtures)
// - ClubElo (dynamische ELO-Ratings, gescraped)
// - Buchmacher-Quoten (TheOddsAPI als Beispiel)
// - Poisson-Score-Modell
//
// Benötigte ENV-Variablen:
// - FOOTBALL_DATA_API_TOKEN  (für football-data.org)
// - ODDS_API_KEY             (für TheOddsAPI oder ähnliche Quoten-API)

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 Stunde: Fixture-Cache
let fixturesCache = { ts: 0, data: null };

const ELO_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 Stunden: ELO-Cache
let eloCache = {}; // { teamName: { ts, elo } }

const ODDS_CACHE_TTL_MS = 15 * 60 * 1000; // 15 Minuten: Quoten-Cache
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

// ClubElo HTML scrapen, um aktuellen ELO-Wert zu bekommen
async function fetchElo(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ELO fetch failed: ${res.status}`);
  const html = await res.text();

  // sehr einfache Heuristik: erste Tabellenzelle mit 3–4-stelliger Zahl
  const match = html.match(/<td>(\d{3,4})<\/td>/);
  if (!match) throw new Error("ELO value not found in HTML");
  return parseInt(match[1], 10);
}

// ELO mit Cache pro Team
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

// Hilfsfunktion: Dezimalquote -> rohe Wahrscheinlichkeit
function probFromOdds(odds) {
  if (!odds || odds <= 1.0) return 0;
  return 1 / odds;
}

// Buchmacher-Quoten abrufen (TheOddsAPI als Beispiel; Endpunkt ggf. anpassen)
async function fetchOddsForMatch(home, away) {
  const ODDS_API_KEY = process.env.ODDS_API_KEY;
  if (!ODDS_API_KEY) return null;

  // Beispiel: Fußball Deutschland Bundesliga
  const url = `https://api.the-odds-api.com/v4/sports/soccer_germany_bundesliga/odds/?apiKey=${ODDS_API_KEY}&regions=eu&markets=h2h`;

  const res = await fetch(url);
  if (!res.ok) {
    console.error("Odds fetch failed:", res.status);
    return null;
  }

  const data = await res.json();

  // Einfaches Matching: Spiel mit gleichem Heim- und Auswärtsteam suchen
  const match = data.find(m => {
    const teams = m.home_team && m.away_team ? [m.home_team, m.away_team] : [];
    return teams.includes(home) && teams.includes(away);
  });

  if (!match || !match.bookmakers || !match.bookmakers.length) return null;

  // Nimm den ersten Buchmacher, Markt h2h (1X2)
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

  // rohe Wahrscheinlichkeiten
  let pHome = probFromOdds(homeOdds);
  let pDraw = probFromOdds(drawOdds);
  let pAway = probFromOdds(awayOdds);

  const total = pHome + pDraw + pAway;
  if (total <= 0) return null;

  // normalisieren (Overround entfernen)
  return {
    home: pHome / total,
    draw: pDraw / total,
    away: pAway / total
  };
}

// Quoten mit Cache pro Match
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

// ---------- ELO → erwartete Tore + Poisson ----------

function expectedGoals(homeElo, awayElo) {
  const diff = homeElo - awayElo + 50; // Heimvorteil

  // geglättete erwartete Tore (xG-ähnlich)
  let homeExp = 1.4 + diff / 500;
  let awayExp = 1.2 - diff / 500;

  // harte Grenzen für realistische Ergebnisse
  homeExp = Math.min(Math.max(homeExp, 0.5), 2.5);
  awayExp = Math.min(Math.max(awayExp, 0.5), 2.5);

  return { home: homeExp, away: awayExp };
}

function poisson(lambda, goals) {
  return (Math.pow(lambda, goals) * Math.exp(-lambda)) / factorial(goals);
}

function factorial(n) {
  return n <= 1 ? 1 : n * factorial(n - 1);
}

// Score-Wahrscheinlichkeit aus ELO/Poisson
function poissonScorePrediction(homeElo, awayElo) {
  const { home, away } = expectedGoals(homeElo, awayElo);

  let bestScore = "1:1";
  let bestProb = 0;

  const maxGoals = 4; // Begrenzung für realistische Ergebnisse

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

// ---------- Kombination ELO + Quoten ----------

// ELO-basierte 1X2-Wahrscheinlichkeiten (vereinfacht)
function eloOutcomeProbs(homeElo, awayElo) {
  const homeAdv = 50;
  const diff = homeElo - awayElo + homeAdv;

  const pHome = 1 / (1 + Math.pow(10, -diff / 400));
  const pAway = 1 - pHome;
  const pDraw = 0.22 + (0.1 * Math.exp(-Math.abs(diff) / 200));

  const total = pHome + pDraw + pAway;
  return {
    home: pHome / total,
    draw: pDraw / total,
    away: pAway / total
  };
}

// ELO + Quoten zu einer kombinierten 1X2-Wahrscheinlichkeit mischen
function combineProbs(eloProbs, oddsProbs) {
  if (!oddsProbs) return eloProbs; // Fallback: nur ELO

  const wElo = 0.5;
  const wOdds = 0.5;

  const home = wElo * eloProbs.home + wOdds * oddsProbs.home;
  const draw = wElo * eloProbs.draw + wOdds * oddsProbs.draw;
  const away = wElo * eloProbs.away + wOdds * oddsProbs.away;

  const total = home + draw + away;
  return {
    home: home / total,
    draw: draw / total,
    away: away / total
  };
}

// ---------- Haupt-Handler ----------

module.exports = async (req, res) => {
  try {
    const now = Date.now();

    // Fixture-Cache
    if (fixturesCache.data && now - fixturesCache.ts < CACHE_TTL_MS) {
      return res.status(200).json({ source: "cache", matches: fixturesCache.data });
    }

    const API_TOKEN = process.env.FOOTBALL_DATA_API_TOKEN;
    if (!API_TOKEN) {
      return res.status(500).json({
        error: "Missing FOOTBALL_DATA_API_TOKEN environment variable. Set it in your hosting provider."
      });
    }

    // Bundesliga-Fixures (SCHEDULED)
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

    for (const m of matches) {
      const home = m.homeTeam?.name ?? "Home";
      const away = m.awayTeam?.name ?? "Away";
      const utc = m.utcDate || new Date().toISOString();
      const dateKey = utc.slice(0, 10);

      // ELO für beide Teams
      const [homeElo, awayElo] = await Promise.all([
        getTeamElo(home),
        getTeamElo(away)
      ]);

      // ELO-basierte 1X2-Wahrscheinlichkeiten
      const eloProbs = eloOutcomeProbs(homeElo, awayElo);

      // Buchmacher-Quoten -> 1X2-Wahrscheinlichkeiten
      const oddsProbs = await getOddsProbs(home, away, dateKey);

      // kombinierte 1X2-Wahrscheinlichkeiten
      const combinedProbs = combineProbs(eloProbs, oddsProbs);

      // Score-Prediction aus ELO/Poisson (für konkretes Ergebnis)
      const scorePred = poissonScorePrediction(homeElo, awayElo);

      fixtures.push({
        id: m.id || `${home}-${away}-${utc}`,
        date: utc.slice(0, 10),
        time: utc.slice(11, 16),
        homeTeam: home,
        awayTeam: away,
        homeElo,
        awayElo,
        // konkretes wahrscheinlichstes Ergebnis (Score)
        prediction: scorePred.prediction,
        predictionConfidence: scorePred.confidence,
        // kombinierte 1X2-Wahrscheinlichkeiten (ELO + Quoten)
        probabilities: {
          home: Math.round(combinedProbs.home * 1000) / 1000,
          draw: Math.round(combinedProbs.draw * 1000) / 1000,
          away: Math.round(combinedProbs.away * 1000) / 1000
        },
        // zur Transparenz: reine ELO- und reine Quoten-Probs
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
