const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const requireAdmin = require('../auth/authMiddleware');
const { sendMail } = require('../utils/mailer');
const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// The full set of destinations this feature supports choosing from.
// Add new ones here if you expand beyond Bahamas/Jamaica later.
const ALLOWED_DESTINATIONS = ['Bahamas', 'Jamaica'];

// Helper: load the current giveaway settings from the DB.
async function getGiveawaySettings() {
  const result = await pool.query(
    'SELECT start_date, end_date, prize_value_usd, prize_value_cad, destinations FROM giveaway_settings WHERE id = 1'
  );
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  return {
    start: new Date(row.start_date),
    end: new Date(row.end_date),
    prizeValueUsd: parseFloat(row.prize_value_usd),
    prizeValueCad: parseFloat(row.prize_value_cad),
    destinations: row.destinations, // JSONB column, comes back already parsed as an array
  };
}

// GET current giveaway settings (public — the site's GiveawaySection reads
// this on load to decide whether to show "coming soon", the form, or
// "ended", what prize amount to display, and which destination(s) to offer)
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
      destinations: settings.destinations,
    });
  } catch (err) {
    console.error('Fetch giveaway settings error:', err);
    res.status(500).json({ error: 'Failed to fetch giveaway settings' });
  }
});

// PATCH update the giveaway settings (admin only)
router.patch('/settings', requireAdmin, async (req, res) => {
  const { startDate, endDate, prizeValueUsd, prizeValueCad, destinations } = req.body;

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
  if (!Array.isArray(destinations) || destinations.length === 0) {
    return res.status(400).json({ error: 'Select at least one destination.' });
  }
  const invalid = destinations.filter((d) => !ALLOWED_DESTINATIONS.includes(d));
  if (invalid.length > 0) {
    return res.status(400).json({ error: `Invalid destination(s): ${invalid.join(', ')}` });
  }

  try {
    await pool.query(
      `INSERT INTO giveaway_settings (id, start_date, end_date, prize_value_usd, prize_value_cad, destinations, updated_at)
       VALUES (1, $1, $2, $3, $4, $5, NOW())
       ON CONFLICT (id) DO UPDATE
       SET start_date = $1, end_date = $2, prize_value_usd = $3, prize_value_cad = $4, destinations = $5, updated_at = NOW()`,
      [start.toISOString(), end.toISOString(), usd, cad, JSON.stringify(destinations)]
    );
    res.json({
      ok: true,
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      prizeValueUsd: usd,
      prizeValueCad: cad,
      destinations,
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
  let settings;
  try {
    settings = await getGiveawaySettings();
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

  // Build the allowed set from live settings: the active destinations, plus
  // "Either" only if more than one destination is currently offered.
  const activeDestinations = settings?.destinations?.length ? settings.destinations : ALLOWED_DESTINATIONS;
  const allowedForEntry = activeDestinations.length > 1
    ? [...activeDestinations, 'Either']
    : activeDestinations;

  // If there's only one active destination, force it regardless of what was
  // submitted — there's no real choice to make in that case.
  const safeDestination = activeDestinations.length === 1
    ? activeDestinations[0]
    : (allowedForEntry.includes(destination) ? destination : activeDestinations[0]);

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

// POST send the "you won" email to a specific entry (admin only)
// Requires the entry to already be marked as the winner. Uses the same
// sendMail util as your inquiries route, and live giveaway settings
// (prize amount, destination, dates) so the email always matches what's
// configured, without hardcoding amounts here.
router.post('/:id/send-winner-email', requireAdmin, async (req, res) => {
  const { id } = req.params;

  try {
    const entryResult = await pool.query('SELECT * FROM giveaway_entries WHERE id = $1', [id]);
    const entry = entryResult.rows[0];

    if (!entry) {
      return res.status(404).json({ error: 'Entry not found' });
    }
    if (!entry.is_winner) {
      return res.status(400).json({ error: 'This entry is not marked as the winner. Mark them as winner first.' });
    }

    const settings = await getGiveawaySettings();
    const destinationLabel = settings?.destinations?.length
      ? (settings.destinations.length === 1
          ? settings.destinations[0]
          : settings.destinations.join(' or '))
      : entry.destination;
    const prizeLabel = settings
      ? `$${settings.prizeValueUsd} USD ($${settings.prizeValueCad} CAD)`
      : 'your prize';

    await sendMail({
      to: entry.email,
      subject: `Congratulations, ${entry.name} — You Won the Sky Unlimited Travel Giveaway! 🎉`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background-color: #1a2947; padding: 24px; border-radius: 8px 8px 0 0; text-align: center;">
            <h1 style="color: white; margin: 0; font-size: 24px;">You're Our Winner! 🎉</h1>
          </div>
          <div style="background-color: #ffffff; padding: 32px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
            <h2 style="color: #1a2947; margin-top: 0;">Hi ${entry.name},</h2>
            <p style="color: #6b7280;">
              Congratulations — you've been randomly selected as the winner of the
              Sky Unlimited Travel giveaway!
            </p>
            <div style="background-color: #f9fafb; border-radius: 8px; padding: 16px; margin: 24px 0;">
              <p style="margin: 4px 0; color: #374151;"><strong>Prize:</strong> ${prizeLabel} credit toward your ${destinationLabel} trip</p>
            </div>
            <p style="color: #6b7280;">
              To claim your prize, please reply to this email or contact us at
              <a href="mailto:info@skyunlimitedtravel.com">info@skyunlimitedtravel.com</a>
              within <strong>7 business days</strong>. Your credit must be used
              toward a booking within <strong>3 months</strong> of this notification.
            </p>
            <p style="color: #9ca3af; font-size: 13px;">If you have any questions, just reply to this email — we're happy to help.</p>
            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
            <p style="color: #9ca3af; font-size: 12px; text-align: center; margin: 0;">
              © ${new Date().getFullYear()} Sky Unlimited Travel Inc. All rights reserved.
            </p>
          </div>
        </div>
      `,
    });

    await pool.query(
      `UPDATE giveaway_entries
       SET winner_email_sent = true, winner_email_sent_at = NOW()
       WHERE id = $1`,
      [id]
    );

    res.json({ ok: true });
  } catch (err) {
    console.error('Send winner email error:', err);
    res.status(500).json({ error: 'Failed to send winner email' });
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