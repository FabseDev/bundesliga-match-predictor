const express = require('express');
const path = require('path');
require('dotenv').config();

const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files from public folder
app.use(express.static(path.join(__dirname, 'public')));

// Mock data
const getMockMatches = () => {
  return [
    {
      id: 1,
      matchday: 1,
      homeTeam: 'FC Bayern München',
      awayTeam: 'VfL Wolfsburg',
      homeScore: 3,
      awayScore: 1,
      probability: 0.72,
      prediction: '3:1',
      confidence: 0.85,
      date: '2024-09-14',
      time: '15:30'
    },
    {
      id: 2,
      matchday: 1,
      homeTeam: 'Borussia Dortmund',
      awayTeam: 'Eintracht Frankfurt',
      homeScore: 2,
      awayScore: 1,
      probability: 0.65,
      prediction: '2:1',
      confidence: 0.78,
      date: '2024-09-14',
      time: '15:30'
    },
    {
      id: 3,
      matchday: 1,
      homeTeam: 'RB Leipzig',
      awayTeam: '1. FC Köln',
      homeScore: 3,
      awayScore: 0,
      probability: 0.68,
      prediction: '3:0',
      confidence: 0.82,
      date: '2024-09-14',
      time: '15:30'
    },
    {
      id: 4,
      matchday: 1,
      homeTeam: 'Bayer Leverkusen',
      awayTeam: 'Mainz 05',
      homeScore: 2,
      awayScore: 0,
      probability: 0.70,
      prediction: '2:0',
      confidence: 0.80,
      date: '2024-09-14',
      time: '15:30'
    },
    {
      id: 5,
      matchday: 1,
      homeTeam: 'SC Freiburg',
      awayTeam: 'Hoffenheim',
      homeScore: 1,
      awayScore: 1,
      probability: 0.55,
      prediction: '1:1',
      confidence: 0.70,
      date: '2024-09-15',
      time: '15:30'
    },
    {
      id: 6,
      matchday: 1,
      homeTeam: 'Union Berlin',
      awayTeam: 'Borussia Mönchengladbach',
      homeScore: 1,
      awayScore: 2,
      probability: 0.48,
      prediction: '1:2',
      confidence: 0.65,
      date: '2024-09-15',
      time: '15:30'
    }
  ];
};

// API Routes
app.get('/api/matches', (req, res) => {
  try {
    const matches = getMockMatches();
    res.json({
      success: true,
      data: matches,
      nextMatchday: 1,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Fehler beim Laden der Spiele'
    });
  }
});

app.get('/api/stats', (req, res) => {
  try {
    const matches = getMockMatches();
    const avgConfidence = (matches.reduce((sum, m) => sum + m.confidence, 0) / matches.length).toFixed(2);
    
    res.json({
      success: true,
      data: {
        totalMatches: matches.length,
        avgConfidence: parseFloat(avgConfidence),
        correctPredictions: Math.floor(matches.length * 0.75),
        accuracyRate: '75%'
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Fehler beim Laden der Statistiken'
    });
  }
});

// Serve index.html for all other routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🏟️  Server läuft auf Port ${PORT}`);
});

module.exports = app;
