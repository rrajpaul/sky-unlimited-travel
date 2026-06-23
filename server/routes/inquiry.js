const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const STRIPE_URL = 'https://buy.stripe.com/9B63cx7II4vfev51iF3Ru01';

// GET all inquiries
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM inquiries ORDER BY created_at DESC'
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Fetch inquiries error:', err);
    res.status(500).json({ error: 'Failed to fetch inquiries' });
  }
});

// POST new inquiry
router.post('/', async (req, res) => {
  const { name, email, phone, country, city, details } = req.body;
  if (!name?.trim() || !email?.trim()) {
    return res.status(400).json({ error: 'Name and email are required.' });
  }
  if (!emailRe.test(email)) {
    return res.status(400).json({ error: 'Invalid email address.' });
  }
  try {
    await pool.query(
      `INSERT INTO inquiries (type, name, email, phone, country, city, details)
       VALUES ('booking', $1, $2, $3, $4, $5, $6)`,
      [
        name.trim(),
        email.trim(),
        phone?.trim() || null,
        country?.trim() || null,
        city?.trim() || null,
        details?.trim() || null,
      ]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('Inquiry insert error:', err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// POST send payment link
router.post('/:id/send-payment-link', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      'SELECT * FROM inquiries WHERE id = $1',
      [id]
    );
    const inquiry = result.rows[0];
    if (!inquiry) return res.status(404).json({ error: 'Inquiry not found' });
    await pool.query(
      `UPDATE inquiries
       SET payment_link_sent = true, payment_link_sent_at = NOW()
       WHERE id = $1`,
      [id]
    );
    res.json({ ok: true, stripeUrl: STRIPE_URL });
  } catch (err) {
    console.error('Send payment link error:', err);
    res.status(500).json({ error: 'Failed to send payment link' });
  }
});

// PATCH payment status (toggle paid/unpaid)
router.patch('/:id/payment-status', async (req, res) => {
  const { id } = req.params;
  const { payment_status } = req.body;

  if (!['paid', 'unpaid'].includes(payment_status)) {
    return res.status(400).json({ error: 'Invalid payment status' });
  }

  try {
    await pool.query(
      `UPDATE inquiries
      SET payment_status = $1::varchar,
          payment_paid_at = CASE WHEN $1::varchar = 'paid' THEN NOW() ELSE NULL END
      WHERE id = $2`,
      [payment_status, id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('Payment status update error:', err);
    res.status(500).json({ error: 'Failed to update payment status' });
  }
});

// POST Stripe webhook
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature error:', err.message);
    return res.status(400).json({ error: `Webhook error: ${err.message}` });
  }
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const email = session.customer_details?.email;
    try {
      await pool.query(
        `UPDATE inquiries
         SET payment_status = 'paid', payment_paid_at = NOW()
         WHERE email = $1`,
        [email]
      );
      console.log(`Payment marked as paid for ${email}`);
    } catch (err) {
      console.error('Webhook DB update error:', err);
    }
  }
  res.json({ received: true });
});

module.exports = router;