async function loadFixtures() {
  try {
    const r = await fetch('/api/fixtures');
    if (!r.ok) throw new Error('API error: ' + r.status);
    const j = await r.json();
    const fixtures = j.matches || [];
    const adapted = fixtures.map((f,i) => ({
      id: f.id || i,
      matchday: f.matchday || '-',
      homeTeam: f.homeTeam,
      awayTeam: f.awayTeam,
      homeScore: '-', awayScore: '-',
      prediction: f.prediction,
      confidence: f.confidence,
      date: f.date,
      time: f.time
    }));
    displayMatches(adapted);
    const avg = adapted.length ? (adapted.reduce((s,m)=>s+m.confidence,0)/adapted.length*100).toFixed(0) : 0;
    document.getElementById('avgConfidence').textContent = avg + '%';
    document.getElementById('totalMatches').textContent = adapted.length;
  } catch (e) {
    console.error('Load fixtures failed', e);
    // Fallback to local matches
    displayMatches(assignUpcomingDates(baseMatches));
    updateStats();
  }
}

document.addEventListener('DOMContentLoaded', loadFixtures);
