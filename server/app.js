// Location: server/app.js
//
// Everything from the old index.js EXCEPT initDb() and app.listen() — those
// two are about starting a live server/process, not about what routes exist.
// Splitting them out means tests (and anything else) can build the app and
// send it requests without opening a real port or requiring a real database
// connection up front.
const express = require('express');
const cors = require('cors');
const contactRoutes = require('./routes/contact');
const inquiryRoutes = require('./routes/inquiry');
const adminRoutes = require('./routes/admin');
const giveawayRoutes = require('./routes/giveaway');
const campaignRoutes = require('./routes/campaigns');

// --- CRM additions ---
const authMiddleware = require('./auth/authMiddleware');
const crmContactsRoutes = require('./routes/contactsCRM');

function createApp() {
  const app = express();

  const allowedOrigins = [
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:5173',
    'https://skyunlimitedtravel.com',
    'https://www.skyunlimitedtravel.com',
    process.env.FRONTEND_URL,
  ].filter(Boolean);

  app.use(cors({
    origin: (origin, cb) => {
      if (!origin || allowedOrigins.some(o => origin.startsWith(o))) return cb(null, true);
      cb(new Error('Not allowed by CORS'));
    },
  }));

  app.use(express.json());

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.use('/api/contact', contactRoutes);
  app.use('/api/inquiry', inquiryRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/giveaway', giveawayRoutes);
  app.use('/api/campaigns', campaignRoutes);

  // --- CRM additions ---
  // Admin-only: same token your /api/admin routes issue
  app.use('/api/contacts', authMiddleware, crmContactsRoutes);

  return app;
}

module.exports = { createApp };