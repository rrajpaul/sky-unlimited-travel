const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const requireAdmin = require('../auth/authMiddleware');
const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Helper: load the current giveaway window from the DB.
// Falls back to "always open" only if no settings row exists at all
// (shouldn't happen after the migration seeds a default row).
async function getGiveawaySettings() {
  const result = await pool.query(
    'SELECT start_date, end_date, prize_value_usd, prize_value_cad FROM giveaway_settings WHERE id = 1'
  );
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  return {
    start: new Date(row.start_date),
    end: new Date(row.end_date),
    prizeValueUsd: parseFloat(row.prize_value_usd),
    prizeValueCad: parseFloat(row.prize_value_cad),
  };
}

// GET current giveaway settings (public — the site's GiveawaySection reads
// this on load to decide whether to show "coming soon", the form, or
// "ended", and what prize amount to display)
router.get('/settings', async (req, res) => {
  try {
    const settings = await getGiveawaySettings();
    if (!settings) {
      return res.status(404).json({ error: 'No giveaway settings configured yet.' });
    }
    res.json({
      startDate: settings.start.toISOString(),
      endDate: settings.end.toISOString(),
      prizeValueUsd: settings.prizeValueUsd,
      prizeValueCad: settings.prizeValueCad,
    });
  } catch (err) {
    console.error('Fetch giveaway settings error:', err);
    res.status(500).json({ error: 'Failed to fetch giveaway settings' });
  }
});

// PATCH update the giveaway settings (admin only)
router.patch('/settings', requireAdmin, async (req, res) => {
  const { startDate, endDate, prizeValueUsd, prizeValueCad } = req.body;

  const start = new Date(startDate);
  const end = new Date(endDate);
  const usd = parseFloat(prizeValueUsd);
  const cad = parseFloat(prizeValueCad);

  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return res.status(400).json({ error: 'Invalid start or end date.' });
  }
  if (start >= end) {
    return res.status(400).json({ error: 'Start date must be before end date.' });
  }
  if (isNaN(usd) || usd <= 0 || isNaN(cad) || cad <= 0) {
    return res.status(400).json({ error: 'Prize values must be positive numbers.' });
  }

  try {
    await pool.query(
      `INSERT INTO giveaway_settings (id, start_date, end_date, prize_value_usd, prize_value_cad, updated_at)
       VALUES (1, $1, $2, $3, $4, NOW())
       ON CONFLICT (id) DO UPDATE
       SET start_date = $1, end_date = $2, prize_value_usd = $3, prize_value_cad = $4, updated_at = NOW()`,
      [start.toISOString(), end.toISOString(), usd, cad]
    );
    res.json({
      ok: true,
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      prizeValueUsd: usd,
      prizeValueCad: cad,
    });
  } catch (err) {
    console.error('Update giveaway settings error:', err);
    res.status(500).json({ error: 'Failed to update giveaway settings' });
  }
});

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
  try {
    const settings = await getGiveawaySettings();
    const now = new Date();
    if (settings && (now < settings.start || now > settings.end)) {
      return res.status(403).json({ error: 'This giveaway is not currently accepting entries.' });
    }
  } catch (err) {
    console.error('Giveaway window check error:', err);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }

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

// PATCH set winner status explicitly (admin only) — body: { is_winner: true|false }
// Setting true clears any other winner first, so only one entry is ever
// the winner at a time. Setting false just clears that entry.
// (Matches the endpoint your AdminGiveawayEntries.jsx toggle switch calls.)
router.patch('/:id/winner', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { is_winner } = req.body;

  if (typeof is_winner !== 'boolean') {
    return res.status(400).json({ error: 'is_winner must be true or false.' });
  }

  try {
    const existing = await pool.query('SELECT id FROM giveaway_entries WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Entry not found' });
    }

    if (is_winner) {
      await pool.query('UPDATE giveaway_entries SET is_winner = false');
      await pool.query('UPDATE giveaway_entries SET is_winner = true WHERE id = $1', [id]);
    } else {
      await pool.query('UPDATE giveaway_entries SET is_winner = false WHERE id = $1', [id]);
    }

    res.json({ ok: true, is_winner });
  } catch (err) {
    console.error('Update winner status error:', err);
    res.status(500).json({ error: 'Failed to update winner status' });
  }
});

// POST pick a random winner from all entries (admin only)
router.post('/pick-winner', requireAdmin, async (req, res) => {
  try {
    const countResult = await pool.query('SELECT COUNT(*) AS c FROM giveaway_entries');
    if (parseInt(countResult.rows[0].c, 10) === 0) {
      return res.status(400).json({ error: 'No entries to pick a winner from.' });
    }

    await pool.query('UPDATE giveaway_entries SET is_winner = false');

    const result = await pool.query(
      'UPDATE giveaway_entries SET is_winner = true WHERE id = (SELECT id FROM giveaway_entries ORDER BY RANDOM() LIMIT 1) RETURNING *'
    );

    res.json({ ok: true, winner: result.rows[0] });
  } catch (err) {
    console.error('Pick winner error:', err);
    res.status(500).json({ error: 'Failed to pick a winner' });
  }
});

module.exports = router;