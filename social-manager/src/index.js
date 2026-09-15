const path = require('path');
const express = require('express');
const { config } = require('./config');
const apiRoutes = require('./routes/api');
const { startScheduler } = require('./scheduler');

const app = express();

// Serves generated images publicly at /previews/<file>.png so Meta's Graph
// API can fetch them by URL (PUBLIC_BASE_URL must point at this server).
app.use('/previews', express.static(path.join(__dirname, '..', 'public', 'previews')));

app.use('/api', apiRoutes);

app.get('/', (req, res) => {
  res.json({
    service: 'Sky Unlimited Travel — Social Media Manager',
    endpoints: {
      health: 'GET /api/health',
      preview: 'POST /api/preview  (generate content + image, do not post)',
      postNow: 'POST /api/post-now (generate + publish to Facebook & Instagram immediately)',
      history: 'GET /api/history?limit=30',
    },
  });
});

app.listen(config.port, () => {
  console.log(`Sky Unlimited Travel social manager listening on port ${config.port}`);
  startScheduler();
});
