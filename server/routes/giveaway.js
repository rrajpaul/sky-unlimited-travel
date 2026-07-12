const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const requireAdmin = require('../auth/authMiddleware');
const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// GET all giveaway entries (admin only)
router.get('/', requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM giveaway_entries ORDER BY created_at DESC'
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Fetch giveaway entries error:', err);
    res.status(500).json({ error: 'Failed to fetch giveaway entries' });
  }
});

// POST new giveaway entry (public — used by the site's entry form)
router.post('/', async (req, res) => {
  const { name, email, destination } = req.body;

  if (!name?.trim() || !email?.trim()) {
    return res.status(400).json({ error: 'Name and email are required.' });
  }
  if (!emailRe.test(email)) {
    return res.status(400).json({ error: 'Invalid email address.' });
  }

  const allowedDestinations = ['Bahamas', 'Jamaica', 'Either'];
  const safeDestination = allowedDestinations.includes(destination) ? destination : 'Either';

  try {
    // Prevent the same email entering more than once
    const existing = await pool.query(
      'SELECT id FROM giveaway_entries WHERE email = $1',
      [email.trim().toLowerCase()]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'This email has already entered.' });
    }

    await pool.query(
      `INSERT INTO giveaway_entries (name, email, destination)
       VALUES ($1, $2, $3)`,
      [name.trim(), email.trim().toLowerCase(), safeDestination]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('Giveaway entry insert error:', err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// PATCH mark a winner (admin only) — flips winner flag, only one entry should be true at a time
router.patch('/:id/mark-winner', requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('UPDATE giveaway_entries SET is_winner = false');
    await pool.query('UPDATE giveaway_entries SET is_winner = true WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Mark winner error:', err);
    res.status(500).json({ error: 'Failed to mark winner' });
  }
});

module.exports = router;