const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const requireAdmin = require('../auth/authMiddleware');

const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ============================================================================
// GET ALL GIVEAWAY ENTRIES (Admin Only)
// ============================================================================
router.get('/', requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT *
      FROM giveaway_entries
      ORDER BY created_at DESC
    `);

    res.json(result.rows);
  } catch (err) {
    console.error('Fetch giveaway entries error:', err);
    res.status(500).json({
      error: 'Failed to fetch giveaway entries',
    });
  }
});

// ============================================================================
// CREATE NEW GIVEAWAY ENTRY (Public)
// ============================================================================
router.post('/', async (req, res) => {
  const { name, email, destination } = req.body;

  if (!name?.trim() || !email?.trim()) {
    return res.status(400).json({
      error: 'Name and email are required.',
    });
  }

  if (!emailRe.test(email)) {
    return res.status(400).json({
      error: 'Invalid email address.',
    });
  }

  const allowedDestinations = [
    'Bahamas',
    'Jamaica',
    'Either',
  ];

  const safeDestination = allowedDestinations.includes(destination)
    ? destination
    : 'Either';

  try {
    // Prevent duplicate entries
    const existing = await pool.query(
      `
      SELECT id
      FROM giveaway_entries
      WHERE email = $1
      `,
      [email.trim().toLowerCase()]
    );

    if (existing.rows.length > 0) {
      return res.status(409).json({
        error: 'This email has already entered.',
      });
    }

    const result = await pool.query(
      `
      INSERT INTO giveaway_entries
      (
        name,
        email,
        destination
      )
      VALUES
      (
        $1,
        $2,
        $3
      )
      RETURNING *
      `,
      [
        name.trim(),
        email.trim().toLowerCase(),
        safeDestination,
      ]
    );

    res.status(201).json({
      success: true,
      entry: result.rows[0],
    });
  } catch (err) {
    console.error('Giveaway entry insert error:', err);

    res.status(500).json({
      error: 'Something went wrong. Please try again.',
    });
  }
});

// ============================================================================
// TOGGLE WINNER (Admin Only)
// Only ONE winner may exist at a time.
// ============================================================================
router.patch('/:id/winner', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { is_winner } = req.body;

  if (typeof is_winner !== 'boolean') {
    return res.status(400).json({
      error: 'is_winner must be true or false.',
    });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    if (is_winner) {
      // Clear previous winner
      await client.query(`
        UPDATE giveaway_entries
        SET is_winner = false
      `);
    }

    const result = await client.query(
      `
      UPDATE giveaway_entries
      SET is_winner = $1
      WHERE id = $2
      RETURNING *
      `,
      [is_winner, id]
    );

    if (result.rowCount === 0) {
      await client.query('ROLLBACK');

      return res.status(404).json({
        error: 'Giveaway entry not found.',
      });
    }

    await client.query('COMMIT');

    res.json({
      success: true,
      entry: result.rows[0],
    });
  } catch (err) {
    await client.query('ROLLBACK');

    console.error('Toggle winner error:', err);

    res.status(500).json({
      error: 'Failed to update winner status.',
    });
  } finally {
    client.release();
  }
});

module.exports = router;