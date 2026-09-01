// Location: tests/integration/components/Admin.integration.test.jsx
//
// WHAT MAKES THIS DIFFERENT FROM THE UNIT TEST
// (tests/unit/components/Admin.test.jsx):
//
// The unit test mocks fetch entirely and asserts against hand-crafted
// responses. This integration test instead exercises the REAL stack:
//   - The REAL server/app.js composition (createApp()) — same CORS config,
//     same route mounting as production, not a test-only reimplementation
//   - The REAL server/routes/admin.js router (bcrypt + jsonwebtoken, real
//     password hashing and verification, real JWT sign/verify)
//   - The REAL server/routes/inquiry.js router (GET /, send-payment-link,
//     payment-status)
//   - A REAL Postgres database — real INSERT/UPDATE/SELECT statements
//
// createApp() also mounts contact/giveaway/campaigns routes and an
// auth-gated /api/contacts (CRM) route that this test never calls — those
// modules still need to exist for createApp() to load without throwing,
// but their real implementations don't matter here. If the placeholder
// stand-ins under server/routes/{contact,giveaway,campaigns,contactsCRM}.js
// and server/auth/authMiddleware.js don't match your real ones, swap them
// in; nothing in this test depends on their actual behavior.
//
// One real side effect is still stubbed, same convention as the booking
// integration test: sendMail (send-payment-link emails the customer a real
// HTML email via inquiry.js). It's monkey-patched on the mailer module
// BEFORE inquiry.js is required, since inquiry.js destructures `sendMail`
// at import time — patching afterward would have no effect on its
// already-captured reference.
//
// Neither Dialog/Button/framer-motion apply here — Admin.jsx doesn't use
// any of them — so nothing else needs mocking beyond apiUrl (to point at
// this real server's real ephemeral port) and sendMail.
//
// REQUIRES a real, disposable Postgres reachable via process.env.DATABASE_URL.
// Never point this at a real/production database: beforeAll/afterAll create
// and drop real `admins` and `inquiries` tables.
import dotenv from 'dotenv';
import path from 'node:path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.test') });

import { createRequire } from 'node:module';
import http from 'node:http';
import bcrypt from 'bcrypt';
import { fetch as undiciFetch } from 'undici';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';

// jsdom doesn't implement fetch; install a real implementation so the
// component's actual fetch(...) calls go out over real localhost networking
// to the real test server below. Same approach as the booking integration test.
globalThis.fetch = undiciFetch;

const require = createRequire(import.meta.url);

// --- Mock ONLY apiUrl (see file-level comment for why) ----------------------
let serverBaseUrl = '';
vi.mock('@/lib/api', () => ({
  apiUrl: (path) => `${serverBaseUrl}${path}`,
}));

// lucide-react icons are real here (Admin.jsx only uses ChevronDown /
// ChevronRight, which don't touch anything jsdom lacks) — nothing to mock.

const { default: AdminPage } = await import('../../../src/components/Admin');

// --- Real Express app, real Postgres pool -----------------------------------
const dbModule = require('../../../server/db.js');
const mailerModule = require('../../../server/utils/mailer.js');

// The ONE backend mock — see file-level comment. Must happen before
// inquiry.js is required (transitively, via createApp below), since it
// destructures `sendMail` at import time.
mailerModule.sendMail = vi.fn().mockResolvedValue();

const { createApp } = require('../../../server/app.js');
const { pool } = dbModule;

const ADMIN_USERNAME = 'admin';
const ADMIN_PASSWORD = 'correct-horse-battery-staple';

let httpServer;

beforeAll(async () => {
  // Real schema, matching exactly the columns admin.js and inquiry.js use.
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
      type VARCHAR(50),
      name TEXT,
      email TEXT,
      phone TEXT,
      destination TEXT,
      details TEXT,
      from_date DATE,
      to_date DATE,
      payment_status VARCHAR(20) DEFAULT 'unpaid',
      payment_link_sent BOOLEAN DEFAULT false,
      payment_link_sent_at TIMESTAMPTZ,
      payment_paid_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // These three exist only so campaigns.js's background worker (started as
  // a side effect of requiring server/app.js, via setInterval/setTimeout at
  // module load — see that file's comments) has something to query without
  // erroring. It isn't exercised by any assertion here, and its hardcoded
  // 5-second startup timer isn't guaranteed to land outside this suite's
  // runtime — without these tables, whether its error output is silent or
  // noisy would depend on how fast this particular run happens to be.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS contacts (
      id SERIAL PRIMARY KEY,
      first_name TEXT,
      last_name TEXT,
      email TEXT,
      tags TEXT[],
      do_not_email BOOLEAN DEFAULT false,
      unsubscribe_token TEXT
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS campaigns (
      id SERIAL PRIMARY KEY,
      subject TEXT,
      html_body TEXT,
      filter_tags TEXT[],
      status VARCHAR(20) DEFAULT 'draft',
      created_by TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      sent_at TIMESTAMPTZ
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS campaign_recipients (
      id SERIAL PRIMARY KEY,
      campaign_id INTEGER REFERENCES campaigns(id),
      contact_id INTEGER REFERENCES contacts(id),
      status VARCHAR(20) DEFAULT 'pending',
      error TEXT,
      sent_at TIMESTAMPTZ,
      UNIQUE (campaign_id, contact_id)
    )
  `);

  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);
  await pool.query(
    'INSERT INTO admins (username, password_hash) VALUES ($1, $2)',
    [ADMIN_USERNAME, passwordHash]
  );

  const app = createApp();
  httpServer = http.createServer(app);
  await new Promise((resolve) => httpServer.listen(0, resolve));
  const { port } = httpServer.address();
  serverBaseUrl = `http://localhost:${port}`;
});

beforeEach(async () => {
  await pool.query('TRUNCATE inquiries RESTART IDENTITY');
  mailerModule.sendMail.mockClear();
  localStorage.clear();
  delete window.location;
  window.location = { href: '' };
});

afterAll(async () => {
  await pool.query('DROP TABLE IF EXISTS campaign_recipients');
  await pool.query('DROP TABLE IF EXISTS campaigns');
  await pool.query('DROP TABLE IF EXISTS contacts');
  await pool.query('DROP TABLE IF EXISTS inquiries');
  await pool.query('DROP TABLE IF EXISTS admins');
  await pool.end();
  await new Promise((resolve) => httpServer.close(resolve));
});

async function seedInquiry(overrides = {}) {
  const { rows } = await pool.query(
    `INSERT INTO inquiries (type, name, email, phone, destination, details, from_date, to_date)
     VALUES ('booking', $1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      overrides.name ?? 'Jane Doe',
      overrides.email ?? 'jane@example.com',
      overrides.phone ?? '555-1234',
      overrides.destination ?? 'Miami, Florida',
      overrides.details ?? 'Anniversary trip',
      overrides.fromDate ?? '2026-09-01',
      overrides.toDate ?? '2026-09-10',
    ]
  );
  return rows[0];
}

async function loginAsAdmin(user) {
  render(<AdminPage />);
  await screen.findByRole('heading', { name: /admin login/i });

  await user.type(screen.getByPlaceholderText(/enter your username/i), ADMIN_USERNAME);
  await user.type(screen.getByPlaceholderText(/enter your password/i), ADMIN_PASSWORD);
  await user.click(screen.getByRole('button', { name: /sign in/i }));
}

describe('AdminPage — full-stack integration', () => {
  it('logs in against the real server, verifies the real JWT, and loads real Postgres rows', async () => {
    await seedInquiry({ name: 'Jane Doe', email: 'jane@example.com' });
    const user = userEvent.setup();

    await loginAsAdmin(user);

    // A real bcrypt.compare + real jwt.sign happened server-side, and the
    // component's own /api/admin/verify round-trip against that real token
    // succeeded, before this real row (inserted directly via pool.query
    // above, not through the UI) is fetched back through GET /api/inquiry.
    await waitFor(() => expect(screen.getAllByText('Jane Doe').length).toBeGreaterThan(0));
    expect(localStorage.getItem('adminToken')).toBeTruthy();
  });

  it('rejects the wrong password with a real 401 from bcrypt.compare', async () => {
    const user = userEvent.setup();
    render(<AdminPage />);
    await screen.findByRole('heading', { name: /admin login/i });

    await user.type(screen.getByPlaceholderText(/enter your username/i), ADMIN_USERNAME);
    await user.type(screen.getByPlaceholderText(/enter your password/i), 'wrong-password');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByText('Invalid credentials')).toBeInTheDocument();
    expect(localStorage.getItem('adminToken')).toBeNull();
  });

  it('verifies a previously-issued real token on mount without logging in again', async () => {
    // Get a real token by actually hitting the real login endpoint, rather
    // than signing one here with jsonwebtoken directly — that library lives
    // in server/node_modules, so a require() from this file wouldn't resolve
    // it. Going through the route is also more faithful: this is genuinely a
    // token the real server issued, not one the test minted to look like one.
    const loginRes = await undiciFetch(`${serverBaseUrl}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD }),
    });
    const { token } = await loginRes.json();
    expect(token).toBeTruthy();
    localStorage.setItem('adminToken', token);

    await seedInquiry({ name: 'Returning Session Row' });

    render(<AdminPage />);

    await waitFor(() => expect(screen.getAllByText('Returning Session Row').length).toBeGreaterThan(0));
    expect(screen.queryByRole('heading', { name: /admin login/i })).not.toBeInTheDocument();
  });

  it('rejects a tampered token with a real 401 from jwt.verify', async () => {
    localStorage.setItem('adminToken', 'this-is-not-a-real-jwt');

    render(<AdminPage />);

    // Note: the login heading renders on the very first synchronous render
    // regardless of whether the real verify request has resolved yet (the
    // component's isLoggedIn state starts false), so it isn't a reliable
    // synchronization point here — wait on the actual token removal instead.
    expect(await screen.findByRole('heading', { name: /admin login/i })).toBeInTheDocument();
    await waitFor(() => expect(localStorage.getItem('adminToken')).toBeNull());
  });

  it('sends a real payment-link email (stubbed transport) and persists the real DB update', async () => {
    const inquiry = await seedInquiry({ name: 'Jane Doe', email: 'jane@example.com' });
    const user = userEvent.setup();
    window.alert = vi.fn();

    await loginAsAdmin(user);
    await waitFor(() => expect(screen.getAllByText('Jane Doe').length).toBeGreaterThan(0));

    const [janeRow] = screen.getAllByText('Jane Doe');
    await user.click(janeRow);

    const [sendButton] = await screen.findAllByRole('button', { name: /send link - pending/i });
    await user.click(sendButton);

    await waitFor(() => {
      expect(window.alert).toHaveBeenCalledWith('Payment link sent to jane@example.com!');
    });

    // The real route really updated the real row — read it straight back out.
    const { rows } = await pool.query('SELECT * FROM inquiries WHERE id = $1', [inquiry.id]);
    expect(rows[0].payment_link_sent).toBe(true);
    expect(rows[0].payment_link_sent_at).not.toBeNull();

    // The email-sending boundary is the one thing still stubbed — confirm
    // the route still tried to call it, without actually emailing anyone.
    expect(mailerModule.sendMail).toHaveBeenCalledTimes(1);
    expect(mailerModule.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'jane@example.com' })
    );
  });

  it('toggles payment status against the real database', async () => {
    const inquiry = await seedInquiry({ name: 'Jane Doe' });
    const user = userEvent.setup();

    await loginAsAdmin(user);
    await waitFor(() => expect(screen.getAllByText('Jane Doe').length).toBeGreaterThan(0));

    const [janeRow] = screen.getAllByText('Jane Doe');
    await user.click(janeRow);

    // The paid/unpaid switch has no accessible text — same as the unit
    // test, target it by its distinguishing utility classes.
    const [toggle] = document.body.querySelectorAll('.h-6.w-11');
    await user.click(toggle);

    await waitFor(async () => {
      const { rows } = await pool.query('SELECT payment_status FROM inquiries WHERE id = $1', [inquiry.id]);
      expect(rows[0].payment_status).toBe('paid');
    });
  });

  it('logs out through a real server call and clears the real session', async () => {
    const user = userEvent.setup();
    await loginAsAdmin(user);
    await screen.findByText(/manage travel bookings/i);

    const [logoutButton] = screen.getAllByRole('button', { name: /logout/i });
    await user.click(logoutButton);

    await waitFor(() => expect(localStorage.getItem('adminToken')).toBeNull());
    expect(await screen.findByRole('heading', { name: /admin login/i })).toBeInTheDocument();
  });
});

// These hit the real routes directly rather than through the UI — the point
// is to prove the server itself rejects unauthenticated callers, which a
// UI-driven test can't show (the UI always sends a token once logged in).
describe('AdminPage — inquiry routes reject unauthenticated callers', () => {
  it('refuses to list inquiries without a token', async () => {
    await seedInquiry({ name: 'Should Not Leak' });

    const res = await undiciFetch(`${serverBaseUrl}/api/inquiry`);

    expect(res.status).toBe(401);
    // The customer PII must not be in the body at all.
    const body = await res.text();
    expect(body).not.toContain('Should Not Leak');
  });

  it('refuses to send a payment link without a token, and sends no email', async () => {
    const inquiry = await seedInquiry({ email: 'victim@example.com' });

    const res = await undiciFetch(
      `${serverBaseUrl}/api/inquiry/${inquiry.id}/send-payment-link`,
      { method: 'POST' }
    );

    expect(res.status).toBe(401);
    expect(mailerModule.sendMail).not.toHaveBeenCalled();

    const { rows } = await pool.query('SELECT payment_link_sent FROM inquiries WHERE id = $1', [inquiry.id]);
    expect(rows[0].payment_link_sent).toBe(false);
  });

  it('refuses to change payment status without a token, and leaves the row unchanged', async () => {
    const inquiry = await seedInquiry();

    const res = await undiciFetch(
      `${serverBaseUrl}/api/inquiry/${inquiry.id}/payment-status`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payment_status: 'paid' }),
      }
    );

    expect(res.status).toBe(401);

    const { rows } = await pool.query('SELECT payment_status FROM inquiries WHERE id = $1', [inquiry.id]);
    expect(rows[0].payment_status).toBe('unpaid');
  });

  it('still accepts a public booking submission (POST /) with no token', async () => {
    // Guarding the admin routes must not break the public booking form.
    const res = await undiciFetch(`${serverBaseUrl}/api/inquiry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Public Customer',
        email: 'public@example.com',
        destination: 'Miami, Florida',
      }),
    });

    expect(res.status).toBe(200);
    const { rows } = await pool.query("SELECT * FROM inquiries WHERE email = 'public@example.com'");
    expect(rows).toHaveLength(1);
  });
});