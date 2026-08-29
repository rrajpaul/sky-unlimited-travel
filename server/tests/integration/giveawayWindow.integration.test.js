// Location: server/tests/integration/giveawayWindow.integration.test.js
//
// Covers the PUBLIC side of the giveaway window — the part that decides
// whether the entry form on the live site is accepting submissions, and what
// dates the countdown shows.
//
// The bug these guard against: start_date/end_date are TIMESTAMP WITHOUT
// TIME ZONE and are written as UTC wall clocks, but node-pg parses a bare
// timestamp in the Node process's LOCAL zone. Reading them with a plain
// `new Date(row.start_date)` therefore shifted the whole window by the
// server's UTC offset, so the form opened and closed four hours late in
// America/Toronto. Every test here is run under several timezones by the
// runner (see the TZ loop in the npm script / CI config) — running them only
// in UTC would pass even with the bug present.
//
// NOTE ON POST /: the window check runs BEFORE Turnstile verification, so a
// request outside the window returns 403 without needing a captcha token,
// while one inside the window gets as far as the missing-token 400. That
// difference is what these assert on, which keeps the tests free of any
// Cloudflare dependency.
//
// REQUIRES a real, disposable Postgres via process.env.DATABASE_URL.
import dotenv from 'dotenv';
import path from 'node:path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.test') });

import { createRequire } from 'node:module';
import http from 'node:http';
import { fetch as undiciFetch } from 'undici';
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';

globalThis.fetch = undiciFetch;

const require = createRequire(import.meta.url);

const dbModule = require('../../db.js');
const mailerModule = require('../../utils/mailer.js');
mailerModule.sendMail = vi.fn().mockResolvedValue();

const { createApp } = require('../../app.js');
const { pool } = dbModule;

let httpServer;
let serverBaseUrl = '';

beforeAll(async () => {
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

  const app = createApp();
  httpServer = http.createServer(app);
  await new Promise((resolve) => httpServer.listen(0, resolve));
  serverBaseUrl = `http://localhost:${httpServer.address().port}`;
});

beforeEach(async () => {
  await pool.query('TRUNCATE giveaway_entries RESTART IDENTITY');
  await pool.query('DELETE FROM giveaway_settings');
});

afterAll(async () => {
  await pool.query('DROP TABLE IF EXISTS giveaway_settings');
  await pool.query('DROP TABLE IF EXISTS giveaway_entries');
  await pool.end();
  await new Promise((resolve) => httpServer.close(resolve));
});

// Writes a window the same way the admin PATCH route does: as UTC wall
// clocks with the offset dropped.
async function setWindow(startIso, endIso) {
  await pool.query(
    `INSERT INTO giveaway_settings (id, start_date, end_date, prize_value_usd, prize_value_cad, destinations)
     VALUES (1, $1, $2, 150, 200, $3)`,
    [startIso, endIso, JSON.stringify(['Bahamas', 'Jamaica'])]
  );
}

const hoursFromNow = (h) => new Date(Date.now() + h * 3600_000).toISOString();

function submitEntry(body = {}) {
  return undiciFetch(`${serverBaseUrl}/api/giveaway`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Jane', email: 'jane@example.com', destination: 'Bahamas', ...body }),
  });
}

describe('POST /api/giveaway — entry window', () => {
  it('accepts an entry when now is inside the window', async () => {
    await setWindow(hoursFromNow(-1), hoursFromNow(1));

    const res = await submitEntry();

    // Past the window gate; stopped later by the missing captcha token.
    expect(res.status).not.toBe(403);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/security verification/i);
  });

  it('rejects an entry before the window opens', async () => {
    await setWindow(hoursFromNow(24), hoursFromNow(48));

    const res = await submitEntry();

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/not currently accepting entries/i);
  });

  it('rejects an entry after the window closes', async () => {
    await setWindow(hoursFromNow(-48), hoursFromNow(-24));

    const res = await submitEntry();

    expect(res.status).toBe(403);
  });

  it('is still open one hour before the window closes', async () => {
    // The old bug shifted the end by the server's UTC offset, so a window
    // closing within the offset window read as still open (or already shut,
    // depending on sign). A margin smaller than a typical offset catches it.
    await setWindow(hoursFromNow(-24), hoursFromNow(1));

    const res = await submitEntry();

    expect(res.status).not.toBe(403);
  });

  it('is already closed one hour after the window closes', async () => {
    await setWindow(hoursFromNow(-24), hoursFromNow(-1));

    const res = await submitEntry();

    expect(res.status).toBe(403);
  });

  it('is not yet open one hour before the window starts', async () => {
    await setWindow(hoursFromNow(1), hoursFromNow(24));

    const res = await submitEntry();

    expect(res.status).toBe(403);
  });

  it('accepts entries when no settings row exists at all', async () => {
    // getGiveawaySettings() returns null and the route skips the gate — the
    // giveaway is treated as unconfigured rather than closed.
    const res = await submitEntry();

    expect(res.status).not.toBe(403);
  });
});

describe('GET /api/giveaway/settings — reported dates', () => {
  it('returns the exact instants that were stored, with no offset drift', async () => {
    const start = '2026-06-01T00:00:00.000Z';
    const end = '2026-06-30T23:59:59.000Z';
    await setWindow(start, end);

    const res = await undiciFetch(`${serverBaseUrl}/api/giveaway/settings`);
    const body = await res.json();

    // This is what the public countdown renders. Under the old bug these
    // came back shifted by the server's offset (e.g. 04:00:00Z / 03:59:59Z
    // next day in America/Toronto).
    expect(body.startDate).toBe(start);
    expect(body.endDate).toBe(end);
  });

  it('404s when no settings have been configured', async () => {
    const res = await undiciFetch(`${serverBaseUrl}/api/giveaway/settings`);
    expect(res.status).toBe(404);
  });

  it('returns the prize values and destinations', async () => {
    await setWindow(hoursFromNow(-1), hoursFromNow(1));

    const res = await undiciFetch(`${serverBaseUrl}/api/giveaway/settings`);
    const body = await res.json();

    expect(body.prizeValueUsd).toBe(150);
    expect(body.prizeValueCad).toBe(200);
    expect(body.destinations).toEqual(['Bahamas', 'Jamaica']);
  });
});