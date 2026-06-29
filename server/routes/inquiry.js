const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const STRIPE_URL = 'https://buy.stripe.com/9B63cx7II4vfev51iF3Ru01';
const { sendMail } = require('../utils/mailer');

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
  const { name, email, phone, country, city, details, fromDate, toDate } = req.body;
  if (!name?.trim() || !email?.trim()) {
    return res.status(400).json({ error: 'Name and email are required.' });
  }
  if (!emailRe.test(email)) {
    return res.status(400).json({ error: 'Invalid email address.' });
  }
  try {
    await pool.query(
      `INSERT INTO inquiries (type, name, email, phone, country, city, details, from_date, to_date)
      VALUES ('booking', $1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        name.trim(),
        email.trim(),
        phone?.trim() || null,
        country?.trim() || null,
        city?.trim() || null,
        details?.trim() || null,
        fromDate || null,
        toDate || null
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
    if (!inquiry) {
      return res.status(404).json({ error: 'Inquiry not found' });
    }

    const destination = [inquiry.country, inquiry.city].filter(Boolean).join(', ');
    const fromDate = inquiry.from_date ? new Date(inquiry.from_date).toLocaleDateString() : null;
    const toDate = inquiry.to_date ? new Date(inquiry.to_date).toLocaleDateString() : null;
    const dateRange = fromDate && toDate ? `${fromDate} – ${toDate}` : null;

    await sendMail({
      to: inquiry.email,
      subject: 'Complete Your Travel Booking – Sky Unlimited Travel',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background-color: #1a2947; padding: 24px; border-radius: 8px 8px 0 0; text-align: center;">
            <h1 style="color: white; margin: 0; font-size: 24px;">Sky Unlimited Travel</h1>
          </div>
          <div style="background-color: #ffffff; padding: 32px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
            <h2 style="color: #1a2947; margin-top: 0;">Hello ${inquiry.name},</h2>
            <p style="color: #6b7280;">Thank you for your travel booking request. Your trip details are below:</p>
            <div style="background-color: #f9fafb; border-radius: 8px; padding: 16px; margin: 24px 0;">
              ${destination ? `<p style="margin: 4px 0; color: #374151;"><strong>Destination:</strong> ${destination}</p>` : ''}
              ${dateRange ? `<p style="margin: 4px 0; color: #374151;"><strong>Travel Dates:</strong> ${dateRange}</p>` : ''}
            </div>
            <p style="color: #6b7280;">To secure your booking, please complete your payment by clicking the button below:</p>
            <div style="text-align: center; margin: 32px 0;">
              <a href="${STRIPE_URL}" style="background-color: #1a2947; color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px; display: inline-block;">
                Complete Payment
              </a>
            </div>
            <p style="color: #9ca3af; font-size: 13px;">If you have any questions, please reply to this email and we'll be happy to help.</p>
            <p style="color: #9ca3af; font-size: 13px;">If you did not request this, please ignore this email.</p>
            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
            <p style="color: #9ca3af; font-size: 12px; text-align: center; margin: 0;">
              © ${new Date().getFullYear()} Sky Unlimited Travel. All rights reserved.
            </p>
          </div>
        </div>
      `,
    });

    await pool.query(
      `UPDATE inquiries
       SET payment_link_sent = true,
           payment_link_sent_at = NOW()
       WHERE id = $1`,
      [id]
    );

    res.json({ ok: true });
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

// POST notify admin of new inquiry
router.post('/notify-admin', async (req, res) => {
  const { name, email, phone, country, city, fromDate, toDate, details } = req.body;

  try {
    await sendMail({
      to: process.env.ADMIN_EMAIL,
      subject: `New Booking Request from ${name}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background-color: #1a2947; padding: 24px; border-radius: 8px 8px 0 0; text-align: center;">
            <h1 style="color: white; margin: 0; font-size: 24px;">New Booking Request</h1>
          </div>
          <div style="background-color: #ffffff; padding: 32px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
            <h2 style="color: #1a2947; margin-top: 0;">Customer Details</h2>
            <div style="background-color: #f9fafb; border-radius: 8px; padding: 16px; margin: 16px 0;">
              <p style="margin: 6px 0; color: #374151;"><strong>Name:</strong> ${name}</p>
              <p style="margin: 6px 0; color: #374151;"><strong>Email:</strong> ${email}</p>
              <p style="margin: 6px 0; color: #374151;"><strong>Phone:</strong> ${phone || 'Not provided'}</p>
              <p style="margin: 6px 0; color: #374151;"><strong>Destination:</strong> ${[country, city].filter(Boolean).join(', ') || 'Not specified'}</p>
              <p style="margin: 6px 0; color: #374151;"><strong>Departure:</strong> ${fromDate || '—'}</p>
              <p style="margin: 6px 0; color: #374151;"><strong>Return:</strong> ${toDate || '—'}</p>
              <p style="margin: 6px 0; color: #374151;"><strong>Details:</strong> ${details || 'None'}</p>
            </div>
            <p style="color: #6b7280; font-size: 14px;">Log in to your admin panel to follow up.</p>
          </div>
        </div>
      `,
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('Admin notification error:', err);
    res.status(500).json({ error: 'Failed to send notification' });
  }
});

module.exports = router;