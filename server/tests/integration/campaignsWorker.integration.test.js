// Location: server/tests/integration/campaignsWorker.integration.test.js
//
// Covers the parts of server/routes/campaigns.js that the UI can't reach,
// against the REAL router and a REAL Postgres. Deliberately does NOT
// re-test what tests/integration/components/CampaignsTab.integration.test.jsx
// already covers (create/edit/delete/preview/send through the interface) —
// this is about worker mechanics and route edge cases.
//
// The highest-value case here is batching. The worker takes
// CAMPAIGN_BATCH_SIZE recipients per tick, and afterwards marks any
// 'sending' campaign with no pending recipients left as 'sent'. If that
// bookkeeping is wrong, a campaign gets flagged sent while people are still
// queued — nobody sees an error, and the only symptom is customers who never
// received the email.
//
// The worker does not auto-start under Vitest (see the IS_TEST_RUN guard in
// campaigns.js), so ticks are driven explicitly through
// POST /api/campaigns/:id/process-queue.
//
// REQUIRES a real, disposable Postgres via process.env.DATABASE_URL.
// beforeAll/afterAll create and drop real tables.
import dotenv from 'dotenv';
import path from 'node:path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.test') });

// campaigns.js reads these ONCE at module load, so they must be set before
// anything requires it (via app.js below).
//   - batch size 3 keeps the arithmetic obvious: 7 recipients = 3 ticks.
//     Production defaults to 20.
//   - the send delay exists to pace a real mail provider; at 150ms per
//     recipient it would add seconds to every test here for no benefit.
process.env.CAMPAIGN_BATCH_SIZE = '3';
process.env.CAMPAIGN_SEND_DELAY_MS = '0';

import { createRequire } from 'node:module';
import http from 'node:http';
import bcrypt from 'bcrypt';
import { fetch as undiciFetch } from 'undici';
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';

globalThis.fetch = undiciFetch;

const require = createRequire(import.meta.url);

const BATCH_SIZE = 3;

const dbModule = require('../../db.js');
const mailerModule = require('../../utils/mailer.js');

// Never touch a real mail provider from a test run.
mailerModule.sendMail = vi.fn().mockResolvedValue();

const { createApp } = require('../../app.js');
const { pool } = dbModule;

const ADMIN_USERNAME = 'worker-admin';
const ADMIN_PASSWORD = 'correct-horse-battery-staple';

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
      campaign_id INTEGER REFERENCES campaigns(id) ON DELETE CASCADE,
      contact_id INTEGER REFERENCES contacts(id),
      status VARCHAR(20) DEFAULT 'pending',
      error TEXT,
      sent_at TIMESTAMPTZ,
      UNIQUE (campaign_id, contact_id)
    )
  `);

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
  await pool.query('TRUNCATE campaign_recipients, campaigns, contacts RESTART IDENTITY CASCADE');
  mailerModule.sendMail.mockReset();
  mailerModule.sendMail.mockResolvedValue();
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await pool.query('DROP TABLE IF EXISTS campaign_recipients');
  await pool.query('DROP TABLE IF EXISTS campaigns');
  await pool.query('DROP TABLE IF EXISTS contacts');
  await pool.query('DROP TABLE IF EXISTS admins');
  await pool.end();
  await new Promise((resolve) => httpServer.close(resolve));
});

async function seedContacts(count, { tag = 'vip' } = {}) {
  const rows = [];
  for (let i = 1; i <= count; i++) {
    const { rows: [row] } = await pool.query(
      `INSERT INTO contacts (first_name, last_name, email, tags, unsubscribe_token)
       VALUES ($1, 'Test', $2, $3, $4) RETURNING *`,
      [`User${i}`, `user${i}@example.com`, [tag], `tok-${i}`]
    );
    rows.push(row);
  }
  return rows;
}

async function seedCampaign({ subject = 'Test Campaign', tags = ['vip'], status = 'draft', body = '<p>Hi</p>' } = {}) {
  const { rows } = await pool.query(
    `INSERT INTO campaigns (subject, html_body, filter_tags, status)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [subject, body, tags, status]
  );
  return rows[0];
}

const queue = (campaignId, body = {}) =>
  undiciFetch(`${baseUrl}/api/campaigns/${campaignId}/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader },
    body: JSON.stringify(body),
  });

const tick = () =>
  undiciFetch(`${baseUrl}/api/campaigns/process-queue`, { method: 'POST', headers: authHeader });

const campaignRow = async (id) =>
  (await pool.query('SELECT * FROM campaigns WHERE id = $1', [id])).rows[0];

const recipientStatuses = async (campaignId) =>
  (await pool.query(
    'SELECT status FROM campaign_recipients WHERE campaign_id = $1 ORDER BY id',
    [campaignId]
  )).rows.map((r) => r.status);

describe('campaigns worker — batching', () => {
  it('sends at most CAMPAIGN_BATCH_SIZE recipients per tick', async () => {
    await seedContacts(7);
    const campaign = await seedCampaign();
    await queue(campaign.id);

    await tick();

    expect(mailerModule.sendMail).toHaveBeenCalledTimes(BATCH_SIZE);
    const statuses = await recipientStatuses(campaign.id);
    expect(statuses.filter((s) => s === 'sent')).toHaveLength(BATCH_SIZE);
    expect(statuses.filter((s) => s === 'pending')).toHaveLength(7 - BATCH_SIZE);
  });

  it('does NOT mark the campaign sent while recipients are still pending', async () => {
    await seedContacts(7);
    const campaign = await seedCampaign();
    await queue(campaign.id);

    await tick();

    // The dangerous failure mode: flagged sent with people still queued, so
    // nobody notices they never received it.
    const row = await campaignRow(campaign.id);
    expect(row.status).toBe('sending');
    expect(row.sent_at).toBeNull();
  });

  it('completes the campaign across successive ticks', async () => {
    await seedContacts(7);
    const campaign = await seedCampaign();
    await queue(campaign.id);

    await tick(); // 3
    await tick(); // 6
    expect((await campaignRow(campaign.id)).status).toBe('sending');

    await tick(); // 7 — done

    expect(mailerModule.sendMail).toHaveBeenCalledTimes(7);
    const row = await campaignRow(campaign.id);
    expect(row.status).toBe('sent');
    expect(row.sent_at).not.toBeNull();
    expect(await recipientStatuses(campaign.id)).toEqual(Array(7).fill('sent'));
  });

  it('flips queued to sending on the first tick', async () => {
    await seedContacts(7);
    const campaign = await seedCampaign();
    await queue(campaign.id);

    expect((await campaignRow(campaign.id)).status).toBe('queued');
    await tick();
    expect((await campaignRow(campaign.id)).status).toBe('sending');
  });

  it('a further tick with nothing pending is a no-op', async () => {
    await seedContacts(2);
    const campaign = await seedCampaign();
    await queue(campaign.id);
    await tick();
    expect((await campaignRow(campaign.id)).status).toBe('sent');

    const sentAt = (await campaignRow(campaign.id)).sent_at;
    mailerModule.sendMail.mockClear();

    await tick();

    expect(mailerModule.sendMail).not.toHaveBeenCalled();
    expect((await campaignRow(campaign.id)).sent_at).toEqual(sentAt);
  });

  it('draws a single batch across multiple queued campaigns', async () => {
    const contacts = await seedContacts(4);
    const a = await seedCampaign({ subject: 'A' });
    const b = await seedCampaign({ subject: 'B' });

    await queue(a.id, { contactIds: [contacts[0].id, contacts[1].id] });
    await queue(b.id, { contactIds: [contacts[2].id, contacts[3].id] });

    // 4 pending total, batch size 3 — one tick spans both campaigns.
    await tick();

    expect(mailerModule.sendMail).toHaveBeenCalledTimes(BATCH_SIZE);
    const all = [...(await recipientStatuses(a.id)), ...(await recipientStatuses(b.id))];
    expect(all.filter((s) => s === 'sent')).toHaveLength(BATCH_SIZE);
    expect(all.filter((s) => s === 'pending')).toHaveLength(1);
  });
});

describe('campaigns worker — concurrency guard', () => {
  it('does not double-send when two ticks overlap', async () => {
    await seedContacts(3);
    const campaign = await seedCampaign();
    await queue(campaign.id);

    // Slow the send so the second tick genuinely arrives mid-batch, which is
    // what isProcessingQueue is there to handle.
    mailerModule.sendMail.mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 80))
    );

    await Promise.all([tick(), tick()]);

    // Each recipient must be emailed exactly once — a duplicate here means
    // a real customer gets the same campaign twice.
    expect(mailerModule.sendMail).toHaveBeenCalledTimes(3);
    const emails = mailerModule.sendMail.mock.calls.map(([arg]) => arg.to);
    expect(new Set(emails).size).toBe(3);
  });
});

describe('campaigns worker — failures', () => {
  it('still completes the campaign when every recipient fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await seedContacts(2);
    const campaign = await seedCampaign();
    await queue(campaign.id);

    mailerModule.sendMail.mockRejectedValue(new Error('Provider down'));
    await tick();
    errorSpy.mockRestore();

    // No pending rows remain, so the campaign is finished even though
    // nothing was delivered — the failures are visible per-recipient.
    const row = await campaignRow(campaign.id);
    expect(row.status).toBe('sent');
    expect(await recipientStatuses(campaign.id)).toEqual(['failed', 'failed']);
  });

  it('truncates a long provider error to 500 characters', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await seedContacts(1);
    const campaign = await seedCampaign();
    await queue(campaign.id);

    mailerModule.sendMail.mockRejectedValue(new Error('x'.repeat(2000)));
    await tick();
    errorSpy.mockRestore();

    const { rows } = await pool.query('SELECT error FROM campaign_recipients WHERE campaign_id = $1', [campaign.id]);
    expect(rows[0].error).toHaveLength(500);
  });

  it('clears a previous error when a retry succeeds', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const [contact] = await seedContacts(1);
    const campaign = await seedCampaign();
    await queue(campaign.id);

    mailerModule.sendMail.mockRejectedValue(new Error('Temporary glitch'));
    await tick();
    errorSpy.mockRestore();

    let { rows } = await pool.query('SELECT status, error FROM campaign_recipients WHERE campaign_id = $1', [campaign.id]);
    expect(rows[0]).toMatchObject({ status: 'failed', error: 'Temporary glitch' });

    // Reset the row to pending the way a manual retry would, then succeed.
    await pool.query(
      `UPDATE campaign_recipients SET status = 'pending' WHERE campaign_id = $1`,
      [campaign.id]
    );
    await pool.query(`UPDATE campaigns SET status = 'queued' WHERE id = $1`, [campaign.id]);
    mailerModule.sendMail.mockResolvedValue();
    await tick();

    ({ rows } = await pool.query('SELECT status, error, sent_at FROM campaign_recipients WHERE campaign_id = $1', [campaign.id]));
    expect(rows[0].status).toBe('sent');
    expect(rows[0].error).toBeNull();
    expect(rows[0].sent_at).not.toBeNull();
    expect(contact.email).toBe('user1@example.com');
  });
});

describe('campaigns worker — scope', () => {
  it('ignores pending rows belonging to a draft campaign', async () => {
    const [contact] = await seedContacts(1);
    const campaign = await seedCampaign({ status: 'draft' });
    // A recipient row without the campaign ever being queued.
    await pool.query(
      `INSERT INTO campaign_recipients (campaign_id, contact_id, status) VALUES ($1, $2, 'pending')`,
      [campaign.id, contact.id]
    );

    await tick();

    // Only 'queued' and 'sending' campaigns are eligible, so a draft must
    // never go out by accident.
    expect(mailerModule.sendMail).not.toHaveBeenCalled();
    expect(await recipientStatuses(campaign.id)).toEqual(['pending']);
    expect((await campaignRow(campaign.id)).status).toBe('draft');
  });

  it('does not duplicate recipients when a campaign is queued twice', async () => {
    const contacts = await seedContacts(2);
    const campaign = await seedCampaign();

    await queue(campaign.id);
    // Re-queueing is rejected once it leaves draft, so exercise the
    // ON CONFLICT path by inserting the same pair again directly.
    for (const c of contacts) {
      await pool.query(
        `INSERT INTO campaign_recipients (campaign_id, contact_id, status)
         VALUES ($1, $2, 'pending') ON CONFLICT (campaign_id, contact_id) DO NOTHING`,
        [campaign.id, c.id]
      );
    }

    const { rows } = await pool.query('SELECT * FROM campaign_recipients WHERE campaign_id = $1', [campaign.id]);
    expect(rows).toHaveLength(2);
  });
});

describe('campaigns routes — edge cases the UI cannot reach', () => {
  it('404s when fetching a campaign that does not exist', async () => {
    const res = await undiciFetch(`${baseUrl}/api/campaigns/99999`, { headers: authHeader });
    expect(res.status).toBe(404);
  });

  it('404s when previewing recipients for a missing campaign', async () => {
    const res = await undiciFetch(`${baseUrl}/api/campaigns/99999/preview-recipients`, { headers: authHeader });
    expect(res.status).toBe(404);
  });

  it('404s when sending a campaign that does not exist', async () => {
    const res = await queue(99999);
    expect(res.status).toBe(404);
  });

  it('refuses to PATCH a campaign that has left draft', async () => {
    const campaign = await seedCampaign({ status: 'sent' });

    const res = await undiciFetch(`${baseUrl}/api/campaigns/${campaign.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeader },
      body: JSON.stringify({ subject: 'New', htmlBody: '<p>New</p>', filterTags: [] }),
    });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/only draft campaigns can be edited/i);
    expect((await campaignRow(campaign.id)).subject).toBe('Test Campaign');
  });

  it('404s when patching a campaign that does not exist', async () => {
    const res = await undiciFetch(`${baseUrl}/api/campaigns/99999`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeader },
      body: JSON.stringify({ subject: 'x', htmlBody: '<p>x</p>', filterTags: [] }),
    });
    expect(res.status).toBe(404);
  });

  it('rejects a draft with a blank subject or body', async () => {
    for (const body of [
      { subject: '   ', htmlBody: '<p>x</p>' },
      { subject: 'Fine', htmlBody: '   ' },
    ]) {
      const res = await undiciFetch(`${baseUrl}/api/campaigns`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify({ ...body, filterTags: [] }),
      });
      expect(res.status).toBe(400);
    }
    const { rows } = await pool.query('SELECT * FROM campaigns');
    expect(rows).toHaveLength(0);
  });

  it('drops blank entries from filterTags', async () => {
    const res = await undiciFetch(`${baseUrl}/api/campaigns`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader },
      body: JSON.stringify({ subject: 'Tagged', htmlBody: '<p>x</p>', filterTags: ['vip', '', '  ', 'news'] }),
    });

    expect(res.status).toBe(200);
    expect((await res.json()).filter_tags).toEqual(['vip', 'news']);
  });

  it('rejects an unauthenticated process-queue call and sends nothing', async () => {
    await seedContacts(1);
    const campaign = await seedCampaign();
    await queue(campaign.id);

    const res = await undiciFetch(`${baseUrl}/api/campaigns/process-queue`, { method: 'POST' });

    expect(res.status).toBe(401);
    expect(mailerModule.sendMail).not.toHaveBeenCalled();
  });
});