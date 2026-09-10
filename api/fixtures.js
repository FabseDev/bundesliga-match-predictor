// Serverless Bundesliga-Predictions nur mit:
// - football-data.org (Fixtures)
// - The Odds API (Quoten)
// - Modell: Quoten -> 1X2-Probs -> erwartete Tore (λ) -> Poisson -> Score-Prediction
//
// ENV-Variablen:
// - FOOTBALL_DATA_API_TOKEN
// - ODDS_API_KEY

const CACHE_TTL_MS = 60 * 60 * 1000; // 1h Cache
let fixturesCache = { ts: 0, data: null };

const ODDS_CACHE_TTL_MS = 15 * 60 * 1000; // 15min Cache
let oddsCache = {}; // { matchId: { ts, probs } }

// ---------- Odds API (optimiert für Credits) ----------

function probFromOdds(odds) {
  if (!odds || odds <= 1.0) return 0;
  return 1 / odds;
}

async function fetchOddsForMatch(matchId) {
  const ODDS_API_KEY = process.env.ODDS_API_KEY;
  if (!ODDS_API_KEY) return null;

  // Optimierte Odds-Abfrage:
  // - eventIds = nur EIN Spiel → spart Credits
  // - regions=uk → günstigste Region
  // - markets=h2h → nur 1X2
  // - oddsFormat=decimal → weniger Daten
  const url =
    `https://api.the-odds-api.com/v4/sports/soccer_germany_bundesliga/odds/` +
    `?apiKey=${ODDS_API_KEY}` +
    `&eventIds=${matchId}` +
    `&regions=uk` +
    `&markets=h2h` +
    `&oddsFormat=decimal`;

  const res = await fetch(url);
  if (!res.ok) {
    console.error("Odds fetch failed:", res.status);
    return null;
  }

  const data = await res.json();
  if (!data || !data.length) return null;

  const bookmaker = data[0].bookmakers?.[0];
  if (!bookmaker) return null;

  const market = bookmaker.markets.find(m => m.key === "h2h");
  if (!market) return null;

  const outcomes = market.outcomes;

  let homeOdds, drawOdds, awayOdds;

  for (const o of outcomes) {
    if (o.name === data[0].home_team) homeOdds = o.price;
    else if (o.name === data[0].away_team) awayOdds = o.price;
    else if (o.name.toLowerCase() === "draw") drawOdds = o.price;
  }

  if (!homeOdds || !awayOdds || !drawOdds) return null;

  const pHome = probFromOdds(homeOdds);
  const pDraw = probFromOdds(drawOdds);
  const pAway = probFromOdds(awayOdds);

  const total = pHome + pDraw + pAway;

  return {
    home: pHome / total,
    draw: pDraw / total,
    away: pAway / total
  };
}

async function getOddsProbs(matchId) {
  const now = Date.now();
  const cached = oddsCache[matchId];

  if (cached && now - cached.ts < ODDS_CACHE_TTL_MS) {
    return cached.probs;
  }

  const probs = await fetchOddsForMatch(matchId);
  if (!probs) return null;

  oddsCache[matchId] = { ts: now, probs };
  return probs;
}

// ---------- Expected Goals aus Quoten ----------

function expectedGoalsFromProbs(probs) {
  const baseHome = 1.65;
  const baseAway = 1.25;

  const strengthDiff = probs.home - probs.away;

  let homeExp = baseHome + strengthDiff * 2.2;
  let awayExp = baseAway - strengthDiff * 2.2;

  homeExp = Math.min(Math.max(homeExp, 0.5), 3.0);
  awayExp = Math.min(Math.max(awayExp, 0.5), 3.0);

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

function poissonScorePredictionFromProbs(probs) {
  const { home, away } = expectedGoalsFromProbs(probs);

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
        error: "Missing FOOTBALL_DATA_API_TOKEN environment variable."
      });
    }

    // ⭐ WICHTIG: Kein Statusfilter → alle Spiele werden geladen
    const url = "https://api.football-data.org/v4/competitions/BL1/matches";

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

    // --- KORREKTER 14-Tage-Datum-Filter ---
    const nowDate = new Date();
    nowDate.setHours(0, 0, 0, 0);

    const cutoffDate = new Date(nowDate.getTime() + 14 * 24 * 60 * 60 * 1000);

    for (const m of matches) {
      const home = m.homeTeam?.name ?? "Home";
      const away = m.awayTeam?.name ?? "Away";
      const utc = m.utcDate || new Date().toISOString();

      const matchDate = new Date(utc);
      const matchDay = new Date(matchDate);
      matchDay.setHours(0, 0, 0, 0);

      if (matchDay < nowDate || matchDay > cutoffDate) {
        continue;
      }

      const matchId = m.id;

      const oddsProbs = await getOddsProbs(matchId);

      // Spiele ohne Quoten trotzdem anzeigen
      if (!oddsProbs) {
        fixtures.push({
          id: matchId,
          date: utc.slice(0, 10),
          time: utc.slice(11, 16),
          homeTeam: home,
          awayTeam: away,
          prediction: "Keine Quoten verfügbar",
          confidence: null,
          probabilities: null,
          oddsProbabilities: null
        });
        continue;
      }

      const scorePred = poissonScorePredictionFromProbs(oddsProbs);

      fixtures.push({
        id: matchId,
        date: utc.slice(0, 10),
        time: utc.slice(11, 16),
        homeTeam: home,
        awayTeam: away,
        prediction: scorePred.prediction,
        confidence: scorePred.confidence,
        probabilities: {
          home: Math.round(oddsProbs.home * 1000) / 1000,
          draw: Math.round(oddsProbs.draw * 1000) / 1000,
          away: Math.round(oddsProbs.away * 1000) / 1000
        },
        oddsProbabilities: oddsProbs
      });
    }

    fixturesCache = { ts: now, data: fixtures };
    return res.status(200).json({ source: "api", matches: fixtures });
  } catch (err) {
    console.error("fixtures error", err);
    return res.status(500).json({ error: err.message });
  }
};
