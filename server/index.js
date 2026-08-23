// Location: server/index.js
require('dotenv').config();
const { initDb } = require('./db');
const { createApp } = require('./app');

const PORT = process.env.PORT || 5000;
const app = createApp();

initDb()
  .then(() => app.listen(PORT, () => console.log(`Server on port ${PORT}`)))
  .catch(err => { console.error('DB init failed:', err); process.exit(1); });