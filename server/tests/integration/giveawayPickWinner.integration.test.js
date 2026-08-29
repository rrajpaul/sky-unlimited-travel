// Location: server/tests/integration/giveawayPickWinner.integration.test.js
//
// Exercises POST /api/giveaway/pick-winner against the REAL giveaway router
// and a REAL Postgres database. The point of these tests is the eligibility
// window: only entries whose created_at falls inside the configured
// start_date/end_date may ever be selected as the winner.
//
// This is a server-only test — no React, no jsdom rendering — so it drives
// the route directly over HTTP rather than through the admin UI.
//
// REQUIRES a real, disposable Postgres reachable via process.env.DATABASE_URL.
// beforeAll/afterAll create and drop real tables.
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

const dbModule = require('../../../server/db.js');
const mailerModule = require('../../../server/utils/mailer.js');

// Never send real winner emails from a test run.
mailerModule.sendMail = vi.fn().mockResolvedValue();

const { createApp } = require('../../../server/app.js');
const { pool } = dbModule;

const ADMIN_USERNAME = 'giveaway-admin';
const ADMIN_PASSWORD = 'correct-horse-battery-staple';

// The configured giveaway window used by every test below.
const WINDOW_START = '2026-06-01T00:00:00.000Z';
const WINDOW_END = '2026-06-30T23:59:59.000Z';

let httpServer;
let serverBaseUrl = '';
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
    CREATE TABLE IF NOT EXISTS giveaway_entries (
      id SERIAL PRIMARY KEY,
      name TEXT,
      email TEXT UNIQUE,
      destination TEXT,
      is_winner BOOLEAN DEFAULT false,
      winner_email_sent BOOLEAN DEFAULT false,
      winner_email_sent_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS giveaway_settings (
      id INTEGER PRIMARY KEY,
      start_date TIMESTAMP NOT NULL,
      end_date TIMESTAMP NOT NULL,
      prize_value_usd NUMERIC,
      prize_value_cad NUMERIC,
      destinations JSONB,
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);
  // campaigns.js starts a background worker on import (see server/app.js);
  // these exist purely so its queries don't error mid-run.
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
  serverBaseUrl = `http://localhost:${httpServer.address().port}`;

  const loginRes = await undiciFetch(`${serverBaseUrl}/api/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD }),
  });
  const { token } = await loginRes.json();
  authHeader = { Authorization: `Bearer ${token}` };
});

beforeEach(async () => {
  await pool.query('TRUNCATE giveaway_entries RESTART IDENTITY');
  await pool.query('DELETE FROM giveaway_settings');
  await pool.query(
    `INSERT INTO giveaway_settings (id, start_date, end_date, prize_value_usd, prize_value_cad, destinations)
     VALUES (1, $1, $2, 1000, 1350, $3)`,
    [WINDOW_START, WINDOW_END, JSON.stringify(['Bahamas', 'Jamaica'])]
  );
  mailerModule.sendMail.mockClear();
});

afterAll(async () => {
  await pool.query('DROP TABLE IF EXISTS campaign_recipients');
  await pool.query('DROP TABLE IF EXISTS campaigns');
  await pool.query('DROP TABLE IF EXISTS contacts');
  await pool.query('DROP TABLE IF EXISTS giveaway_settings');
  await pool.query('DROP TABLE IF EXISTS giveaway_entries');
  await pool.query('DROP TABLE IF EXISTS admins');
  await pool.end();
  await new Promise((resolve) => httpServer.close(resolve));
});

async function seedEntry(name, createdAt) {
  const { rows } = await pool.query(
    `INSERT INTO giveaway_entries (name, email, destination, created_at)
     VALUES ($1, $2, 'Bahamas', $3) RETURNING *`,
    [name, `${name.toLowerCase().replace(/\s+/g, '-')}@example.com`, createdAt]
  );
  return rows[0];
}

function pickWinner() {
  return undiciFetch(`${serverBaseUrl}/api/giveaway/pick-winner`, {
    method: 'POST',
    headers: authHeader,
  });
}

describe('POST /api/giveaway/pick-winner — eligibility window', () => {
  it('never picks an entry created before the window opens', async () => {
    await seedEntry('Too Early', '2026-05-31T23:59:59.000Z');
    await seedEntry('Inside Window', '2026-06-15T12:00:00.000Z');

    // Random selection — run repeatedly so a lucky pass can't hide a bug.
    for (let i = 0; i < 15; i++) {
      const res = await pickWinner();
      expect(res.status).toBe(200);
      const { winner } = await res.json();
      expect(winner.name).toBe('Inside Window');
    }
  });

  it('never picks an entry created after the window closes', async () => {
    await seedEntry('Inside Window', '2026-06-15T12:00:00.000Z');
    await seedEntry('Too Late', '2026-07-01T00:00:01.000Z');

    for (let i = 0; i < 15; i++) {
      const res = await pickWinner();
      const { winner } = await res.json();
      expect(winner.name).toBe('Inside Window');
    }
  });

  it('treats the window boundaries as inclusive', async () => {
    await seedEntry('Exactly At Start', WINDOW_START);
    await seedEntry('Exactly At End', WINDOW_END);

    const seen = new Set();
    for (let i = 0; i < 30; i++) {
      const res = await pickWinner();
      const { winner } = await res.json();
      seen.add(winner.name);
    }
    // Both boundary entries are eligible, so over 30 draws both should appear.
    expect(seen).toEqual(new Set(['Exactly At Start', 'Exactly At End']));
  });

  it('reports how many entries were eligible', async () => {
    await seedEntry('In One', '2026-06-02T00:00:00.000Z');
    await seedEntry('In Two', '2026-06-03T00:00:00.000Z');
    await seedEntry('Out', '2026-01-01T00:00:00.000Z');

    const res = await pickWinner();
    const body = await res.json();
    expect(body.eligibleCount).toBe(2);
  });

  it('refuses when entries exist but none fall inside the window, and preserves the current winner', async () => {
    const stale = await seedEntry('Out Of Window', '2026-01-01T00:00:00.000Z');
    await pool.query('UPDATE giveaway_entries SET is_winner = true WHERE id = $1', [stale.id]);

    const res = await pickWinner();

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/within the giveaway window/i);

    // The pre-existing winner must NOT have been cleared by a failed pick.
    const { rows } = await pool.query('SELECT is_winner FROM giveaway_entries WHERE id = $1', [stale.id]);
    expect(rows[0].is_winner).toBe(true);
  });

  it('refuses when no giveaway settings are configured', async () => {
    await pool.query('DELETE FROM giveaway_settings');
    await seedEntry('Someone', '2026-06-15T12:00:00.000Z');

    const res = await pickWinner();

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/no giveaway settings configured/i);
  });

  it('leaves exactly one winner after picking', async () => {
    await seedEntry('A', '2026-06-05T00:00:00.000Z');
    await seedEntry('B', '2026-06-06T00:00:00.000Z');
    await seedEntry('C', '2026-06-07T00:00:00.000Z');

    await pickWinner();
    await pickWinner();
    await pickWinner();

    const { rows } = await pool.query('SELECT COUNT(*) AS c FROM giveaway_entries WHERE is_winner = true');
    expect(parseInt(rows[0].c, 10)).toBe(1);
  });

  it('rejects an unauthenticated caller and picks nobody', async () => {
    await seedEntry('Inside Window', '2026-06-15T12:00:00.000Z');

    const res = await undiciFetch(`${serverBaseUrl}/api/giveaway/pick-winner`, { method: 'POST' });

    expect(res.status).toBe(401);
    const { rows } = await pool.query('SELECT COUNT(*) AS c FROM giveaway_entries WHERE is_winner = true');
    expect(parseInt(rows[0].c, 10)).toBe(0);
  });
});