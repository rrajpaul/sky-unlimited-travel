// Location: server/tests/integration/emailEscaping.integration.test.js
//
// Several email bodies are built with template literals containing values
// that arrived from a PUBLIC, unauthenticated form:
//   - POST /api/inquiry/notify-admin  → every field, emailed to ADMIN_EMAIL
//   - POST /api/inquiry/:id/send-payment-link → name/destination, emailed to
//     the customer, containing a payment link
//   - POST /api/giveaway/:id/send-winner-email → entrant name
//
// Unescaped, anyone could post markup that renders in an inbox — at worst an
// attacker-controlled link inside a message genuinely sent from your domain.
//
// These assert on the html actually handed to sendMail, against the real
// routes and a real Postgres.
//
// REQUIRES a real, disposable Postgres via process.env.DATABASE_URL.
import dotenv from 'dotenv';
import path from 'node:path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.test') });

import { createRequire } from 'node:module';
import http from 'node:http';
import bcrypt from 'bcrypt';
import { fetch as undiciFetch } from 'undici';
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';

globalThis.fetch = undiciFetch;

const require = createRequire(import.meta.url);

const dbModule = require('../../db.js');
const mailerModule = require('../../utils/mailer.js');
mailerModule.sendMail = vi.fn().mockResolvedValue();

const { createApp } = require('../../app.js');
const { pool } = dbModule;

const ADMIN_USERNAME = 'escaping-admin';
const ADMIN_PASSWORD = 'correct-horse-battery-staple';

// A name that would break out of the surrounding markup if interpolated raw.
const MALICIOUS = '<script>alert(1)</script><a href="http://evil.test">Click</a>';

let httpServer;
let baseUrl = '';
let authHeader = {};

beforeAll(async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admins (
      id SERIAL PRIMARY KEY,
      username VARCHAR(255) UNIQUE NOT NULL,
      password_hash TEXT NOT NULL
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS inquiries (
      id SERIAL PRIMARY KEY,
      type VARCHAR(50), name TEXT, email TEXT, phone TEXT,
      destination TEXT, details TEXT, message TEXT,
      from_date DATE, to_date DATE,
      payment_status VARCHAR(20) DEFAULT 'unpaid',
      payment_link_sent BOOLEAN DEFAULT false,
      payment_link_sent_at TIMESTAMP,
      payment_paid_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS giveaway_entries (
      id SERIAL PRIMARY KEY,
      name TEXT, email TEXT UNIQUE, destination TEXT,
      is_winner BOOLEAN DEFAULT false,
      winner_email_sent BOOLEAN DEFAULT false,
      winner_email_sent_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS giveaway_settings (
      id INTEGER PRIMARY KEY,
      start_date TIMESTAMP NOT NULL, end_date TIMESTAMP NOT NULL,
      prize_value_usd NUMERIC, prize_value_cad NUMERIC,
      destinations JSONB, updated_at TIMESTAMP DEFAULT NOW()
    )
  `);
  // Present only so campaigns.js's queries have somewhere to point.
  await pool.query(`CREATE TABLE IF NOT EXISTS contacts (
    id SERIAL PRIMARY KEY, first_name TEXT, last_name TEXT, email TEXT,
    tags TEXT[], do_not_email BOOLEAN DEFAULT false, unsubscribe_token TEXT)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS campaigns (
    id SERIAL PRIMARY KEY, subject TEXT, html_body TEXT, filter_tags TEXT[],
    status VARCHAR(20) DEFAULT 'draft', created_by TEXT,
    created_at TIMESTAMP DEFAULT NOW(), sent_at TIMESTAMP)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS campaign_recipients (
    id SERIAL PRIMARY KEY, campaign_id INTEGER REFERENCES campaigns(id),
    contact_id INTEGER REFERENCES contacts(id), status VARCHAR(20) DEFAULT 'pending',
    error TEXT, sent_at TIMESTAMP, UNIQUE (campaign_id, contact_id))`);

  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);
  await pool.query(
    `INSERT INTO admins (username, password_hash) VALUES ($1, $2)
     ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
    [ADMIN_USERNAME, passwordHash]
  );

  const app = createApp();
  httpServer = http.createServer(app);
  await new Promise((resolve) => httpServer.listen(0, resolve));
  baseUrl = `http://localhost:${httpServer.address().port}`;

  const res = await undiciFetch(`${baseUrl}/api/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD }),
  });
  authHeader = { Authorization: `Bearer ${(await res.json()).token}` };
});

beforeEach(async () => {
  await pool.query('TRUNCATE inquiries, giveaway_entries RESTART IDENTITY CASCADE');
  await pool.query('DELETE FROM giveaway_settings');
  mailerModule.sendMail.mockClear();
  mailerModule.sendMail.mockResolvedValue();
});

afterAll(async () => {
  await pool.query('DROP TABLE IF EXISTS campaign_recipients');
  await pool.query('DROP TABLE IF EXISTS campaigns');
  await pool.query('DROP TABLE IF EXISTS contacts');
  await pool.query('DROP TABLE IF EXISTS giveaway_settings');
  await pool.query('DROP TABLE IF EXISTS giveaway_entries');
  await pool.query('DROP TABLE IF EXISTS inquiries');
  await pool.query('DROP TABLE IF EXISTS admins');
  await pool.end();
  await new Promise((resolve) => httpServer.close(resolve));
});

const sentHtml = () => mailerModule.sendMail.mock.calls[0][0].html;

// Asserts the payload was neutralised: the raw tags are gone and their
// escaped equivalents are present.
function expectEscaped(html) {
  expect(html).not.toContain('<script>');
  expect(html).not.toContain('<a href="http://evil.test">');
  expect(html).toContain('&lt;script&gt;');
  expect(html).toContain('&lt;a href=&quot;http://evil.test&quot;&gt;');
}

describe('POST /api/inquiry/notify-admin — escaping', () => {
  it('escapes a malicious name', async () => {
    await undiciFetch(`${baseUrl}/api/inquiry/notify-admin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader },
      body: JSON.stringify({ name: MALICIOUS, email: 'jane@example.com' }),
    });

    expect(mailerModule.sendMail).toHaveBeenCalledTimes(1);
    expectEscaped(sentHtml());
  });

  it('escapes every other user-supplied field', async () => {
    await undiciFetch(`${baseUrl}/api/inquiry/notify-admin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader },
      body: JSON.stringify({
        name: 'Jane',
        email: MALICIOUS,
        phone: MALICIOUS,
        destination: MALICIOUS,
        fromDate: MALICIOUS,
        toDate: MALICIOUS,
        details: MALICIOUS,
      }),
    });

    const html = sentHtml();
    expectEscaped(html);
    // Six escaped occurrences, one per field — none slipped through raw.
    expect(html.split('&lt;script&gt;').length - 1).toBe(6);
  });

  it('still shows the placeholder text for omitted optional fields', async () => {
    // escapeHtml(null) returns '', which must stay falsy so the existing
    // `|| 'Not provided'` fallbacks keep working.
    await undiciFetch(`${baseUrl}/api/inquiry/notify-admin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader },
      body: JSON.stringify({ name: 'Jane', email: 'jane@example.com' }),
    });

    const html = sentHtml();
    expect(html).toContain('Not provided');
    expect(html).toContain('Not specified');
    expect(html).toContain('None');
  });

  it('leaves ordinary text readable', async () => {
    await undiciFetch(`${baseUrl}/api/inquiry/notify-admin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader },
      body: JSON.stringify({
        name: "Jane O'Brien",
        email: 'jane@example.com',
        details: 'Anniversary trip — 2 adults & 1 child',
      }),
    });

    const html = sentHtml();
    // Escaped in the source, but renders as the original text in a client.
    expect(html).toContain('Jane O&#39;Brien');
    expect(html).toContain('2 adults &amp; 1 child');
    // The em dash is not an HTML metacharacter and must pass through as-is.
    expect(html).toContain('Anniversary trip —');
  });
});

describe('POST /api/inquiry/:id/send-payment-link — escaping', () => {
  it('escapes the customer name and destination', async () => {
    const { rows } = await pool.query(
      `INSERT INTO inquiries (type, name, email, destination)
       VALUES ('booking', $1, 'jane@example.com', $2) RETURNING *`,
      [MALICIOUS, MALICIOUS]
    );

    const res = await undiciFetch(`${baseUrl}/api/inquiry/${rows[0].id}/send-payment-link`, {
      method: 'POST',
      headers: authHeader,
    });

    expect(res.status).toBe(200);
    expectEscaped(sentHtml());
  });

  it('still includes the real Stripe link', async () => {
    const { rows } = await pool.query(
      `INSERT INTO inquiries (type, name, email, destination)
       VALUES ('booking', $1, 'jane@example.com', 'Miami') RETURNING *`,
      [MALICIOUS]
    );

    await undiciFetch(`${baseUrl}/api/inquiry/${rows[0].id}/send-payment-link`, {
      method: 'POST',
      headers: authHeader,
    });

    // Escaping user input must not touch the app's own markup.
    expect(sentHtml()).toContain('href="https://buy.stripe.com/');
  });
});

describe('POST /api/giveaway/:id/send-winner-email — escaping', () => {
  it('escapes the entrant name', async () => {
    const { rows } = await pool.query(
      `INSERT INTO giveaway_entries (name, email, destination, is_winner)
       VALUES ($1, 'winner@example.com', 'Bahamas', true) RETURNING *`,
      [MALICIOUS]
    );

    const res = await undiciFetch(`${baseUrl}/api/giveaway/${rows[0].id}/send-winner-email`, {
      method: 'POST',
      headers: authHeader,
    });

    expect(res.status).toBe(200);
    expectEscaped(sentHtml());
  });

  it('escapes a destination that falls back to the entry value', async () => {
    // With no settings row, destinationLabel falls back to the entrant's own
    // submitted destination — also user-controlled.
    const { rows } = await pool.query(
      `INSERT INTO giveaway_entries (name, email, destination, is_winner)
       VALUES ('Jane', 'winner@example.com', $1, true) RETURNING *`,
      [MALICIOUS]
    );

    await undiciFetch(`${baseUrl}/api/giveaway/${rows[0].id}/send-winner-email`, {
      method: 'POST',
      headers: authHeader,
    });

    expectEscaped(sentHtml());
  });
});

describe('escapeHtml helper', () => {
  const { escapeHtml } = require('../../utils/escapeHtml.js');

  it('escapes the five HTML metacharacters', () => {
    expect(escapeHtml('<>&"\'')).toBe('&lt;&gt;&amp;&quot;&#39;');
  });

  it('escapes ampersands first so nothing is double-escaped', () => {
    // Getting the order wrong turns '<' into '&amp;lt;', which renders as
    // the literal text "&lt;" in an inbox.
    expect(escapeHtml('<')).toBe('&lt;');
    expect(escapeHtml('&lt;')).toBe('&amp;lt;');
  });

  it('returns an empty string for null and undefined', () => {
    // Must be falsy so the routes' `|| 'Not provided'` fallbacks still fire.
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });

  it('stringifies non-string input', () => {
    expect(escapeHtml(42)).toBe('42');
    expect(escapeHtml(false)).toBe('false');
  });

  it('leaves ordinary text untouched', () => {
    expect(escapeHtml('Anniversary trip — 2 adults')).toBe('Anniversary trip — 2 adults');
  });
});

describe('POST /api/inquiry — server-side admin notification', () => {
  it('emails the admin when a public booking is submitted, with no second call', async () => {
    const res = await undiciFetch(`${baseUrl}/api/inquiry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Jane Doe', email: 'jane@example.com', destination: 'Miami' }),
    });

    expect(res.status).toBe(200);

    // One public request now both stores the inquiry and notifies the admin.
    const { rows } = await pool.query('SELECT * FROM inquiries');
    expect(rows).toHaveLength(1);
    expect(mailerModule.sendMail).toHaveBeenCalledTimes(1);
    expect(mailerModule.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ subject: 'New Booking Request from Jane Doe' })
    );
  });

  it('escapes a malicious name in the notification it sends', async () => {
    await undiciFetch(`${baseUrl}/api/inquiry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: MALICIOUS, email: 'jane@example.com' }),
    });

    expectEscaped(sentHtml());
  });

  it('still saves the booking when the notification email fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mailerModule.sendMail.mockRejectedValue(new Error('Graph API down'));

    const res = await undiciFetch(`${baseUrl}/api/inquiry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Jane Doe', email: 'jane@example.com' }),
    });
    errorSpy.mockRestore();

    // Losing a real customer's booking because email was down would be far
    // worse than a missed notification, so the failure must not surface here.
    expect(res.status).toBe(200);
    const { rows } = await pool.query('SELECT * FROM inquiries');
    expect(rows).toHaveLength(1);
  });

  it('does not email when the inquiry is rejected as invalid', async () => {
    const res = await undiciFetch(`${baseUrl}/api/inquiry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Jane Doe', email: 'not-an-email' }),
    });

    expect(res.status).toBe(400);
    expect(mailerModule.sendMail).not.toHaveBeenCalled();
    const { rows } = await pool.query('SELECT * FROM inquiries');
    expect(rows).toHaveLength(0);
  });

  it('rejects an unauthenticated notify-admin call and sends nothing', async () => {
    const res = await undiciFetch(`${baseUrl}/api/inquiry/notify-admin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: MALICIOUS, email: 'attacker@example.com' }),
    });

    // This was a public, unauthenticated email-sending endpoint. Anyone could
    // flood the admin inbox with attacker-written content from your domain.
    expect(res.status).toBe(401);
    expect(mailerModule.sendMail).not.toHaveBeenCalled();
  });
});