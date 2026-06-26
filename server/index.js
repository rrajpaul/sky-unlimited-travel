require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { initDb } = require('./db');
const contactRoutes = require('./routes/contact');
const inquiryRoutes = require('./routes/inquiry');
const adminRoutes = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 5000;

const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:5173',
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

initDb()
  .then(() => app.listen(PORT, () => console.log(`Server on port ${PORT}`)))
  .catch(err => { console.error('DB init failed:', err); process.exit(1); });
