// Serverless endpoint for Vercel/Netlify to fetch upcoming Bundesliga fixtures from football-data.org
// and return simple predictions. Requires environment variable FOOTBALL_DATA_API_TOKEN.

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
let cache = { ts: 0, data: null };

function simplePredict(home, away) {
  // Very small heuristic: home advantage + random variation
  const baseHome = 0.46, baseDraw = 0.28, baseAway = 0.26;
  const rnd = (Math.random() - 0.5) * 0.14; // ±0.07
  const pHome = Math.min(Math.max(baseHome + rnd, 0.15), 0.85);
  const pDraw = Math.min(Math.max(baseDraw - rnd / 2, 0.05), 0.7);
  const pAway = Math.max(1 - pHome - pDraw, 0.03);

  let score;
  if (pHome > 0.55) score = '2:1';
  else if (pAway > 0.45) score = '1:2';
  else score = '1:1';

  const confidence = Math.round(Math.max(pHome, pDraw, pAway) * 100) / 100;
  return { prediction: score, confidence };
}

module.exports = async (req, res) => {
  try {
    const now = Date.now();
    if (cache.data && (now - cache.ts) < CACHE_TTL_MS) {
      return res.status(200).json({ source: 'cache', matches: cache.data });
    }

    const API_TOKEN = process.env.FOOTBALL_DATA_API_TOKEN;
    if (!API_TOKEN) {
      return res.status(500).json({ error: 'Missing FOOTBALL_DATA_API_TOKEN environment variable. Set it in your hosting provider.' });
    }

    // football-data.org v2 endpoint for competition BL1 (Bundesliga)
    const url = 'https://api.football-data.org/v2/competitions/BL1/matches?status=SCHEDULED';

    const fetchRes = await fetch(url, { headers: { 'X-Auth-Token': API_TOKEN } });
    if (!fetchRes.ok) {
      const text = await fetchRes.text();
      return res.status(502).json({ error: 'Upstream error', detail: text });
    }

    const payload = await fetchRes.json();
    const fixtures = (payload.matches || []).map(m => {
      const home = (m.homeTeam && m.homeTeam.name) || (m.homeTeam && m.homeTeam.shortName) || 'Home';
      const away = (m.awayTeam && m.awayTeam.name) || (m.awayTeam && m.awayTeam.shortName) || 'Away';
      const utc = m.utcDate || m.date || new Date().toISOString();
      const pred = simplePredict(home, away);
      return {
        id: m.id || `${home}-${away}-${utc}`,
        date: utc.slice(0, 10),
        time: utc.slice(11, 16),
        homeTeam: home,
        awayTeam: away,
        prediction: pred.prediction,
        confidence: pred.confidence
      };
    });

    cache = { ts: now, data: fixtures };
    return res.status(200).json({ source: 'api', matches: fixtures });
  } catch (err) {
    console.error('fixtures error', err);
    return res.status(500).json({ error: err.message });
  }
};
