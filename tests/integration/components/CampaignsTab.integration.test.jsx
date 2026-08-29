// Location: tests/integration/components/CampaignsTab.integration.test.jsx
//
// WHAT MAKES THIS DIFFERENT FROM THE UNIT TEST
// (tests/unit/components/CampaignsTab.test.jsx):
//
// The unit test stubs fetch and asserts on request shapes. This drives the
// REAL stack: the real server/app.js composition, the real
// server/routes/campaigns.js router, and a REAL Postgres — real campaigns,
// campaign_recipients and contacts rows, read back after each action.
//
// That matters most for the recipient-selection rules. Whether someone with
// do_not_email = true is excluded, or whether a hand-picked contactIds list
// can override that exclusion, is decided by SQL in the router — a mocked
// fetch can't tell you if those filters actually work. Getting them wrong
// means emailing people who asked not to be emailed.
//
// Two things are still faked, deliberately:
//   1. apiUrl, pointed at this test server's real ephemeral port (jsdom has
//      no other way to know it).
//   2. sendMail, so a test run never hits the real Microsoft Graph API.
//      Everything up to that boundary — recipient rows, statuses, campaign
//      state transitions — is real.
//
// The background send worker in campaigns.js does not auto-start under
// Vitest (see the IS_TEST_RUN guard there), so these tests drive sending
// explicitly via POST /api/campaigns/:id/process-queue instead of waiting
// on a timer.
//
// REQUIRES a real, disposable Postgres via process.env.DATABASE_URL.
// beforeAll/afterAll create and drop real tables.
import dotenv from 'dotenv';
import path from 'node:path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.test') });

import React from 'react';
import { createRequire } from 'node:module';
import http from 'node:http';
import bcrypt from 'bcrypt';
import { fetch as undiciFetch } from 'undici';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';

// jsdom has no fetch of its own; install a real one so the component's
// requests go out over real localhost networking to the test server below.
globalThis.fetch = undiciFetch;

const require = createRequire(import.meta.url);

let serverBaseUrl = '';
vi.mock('@/lib/api', () => ({
  apiUrl: (path) => `${serverBaseUrl}${path}`,
}));

const { default: CampaignsTab } = await import('../../../src/components/CampaignsTab');

const dbModule = require('../../../server/db.js');
const mailerModule = require('../../../server/utils/mailer.js');

// The ONE backend mock. Must be in place before campaigns.js is required
// (transitively via createApp below), since it destructures sendMail at
// import time.
mailerModule.sendMail = vi.fn().mockResolvedValue();

const { createApp } = require('../../../server/app.js');
const { pool } = dbModule;

const ADMIN_USERNAME = 'campaigns-admin';
const ADMIN_PASSWORD = 'correct-horse-battery-staple';

let httpServer;
let adminToken = '';

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
      created_at TIMESTAMP DEFAULT NOW(),
      sent_at TIMESTAMP
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS campaign_recipients (
      id SERIAL PRIMARY KEY,
      campaign_id INTEGER REFERENCES campaigns(id) ON DELETE CASCADE,
      contact_id INTEGER REFERENCES contacts(id),
      status VARCHAR(20) DEFAULT 'pending',
      error TEXT,
      sent_at TIMESTAMP,
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
  serverBaseUrl = `http://localhost:${httpServer.address().port}`;

  // A real token from the real login route — the component reads this from
  // localStorage for every request it makes.
  const res = await undiciFetch(`${serverBaseUrl}/api/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD }),
  });
  adminToken = (await res.json()).token;
});

beforeEach(async () => {
  await pool.query('TRUNCATE campaign_recipients, campaigns, contacts RESTART IDENTITY CASCADE');
  mailerModule.sendMail.mockClear();
  mailerModule.sendMail.mockResolvedValue();
  localStorage.setItem('adminToken', adminToken);
  vi.stubGlobal('confirm', vi.fn(() => true));
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

afterAll(async () => {
  await pool.query('DROP TABLE IF EXISTS campaign_recipients');
  await pool.query('DROP TABLE IF EXISTS campaigns');
  await pool.query('DROP TABLE IF EXISTS contacts');
  await pool.query('DROP TABLE IF EXISTS admins');
  await pool.end();
  await new Promise((resolve) => httpServer.close(resolve));
});

async function seedContact({ firstName, lastName = 'Test', email, tags = [], doNotEmail = false }) {
  const { rows } = await pool.query(
    `INSERT INTO contacts (first_name, last_name, email, tags, do_not_email, unsubscribe_token)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [firstName, lastName, email, tags, doNotEmail, `tok-${firstName.toLowerCase()}`]
  );
  return rows[0];
}

async function seedCampaign({ subject, htmlBody = '<p>Hello</p>', tags = [], status = 'draft' }) {
  const { rows } = await pool.query(
    `INSERT INTO campaigns (subject, html_body, filter_tags, status)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [subject, htmlBody, tags, status]
  );
  return rows[0];
}

// Drives the background worker one batch, the way the real interval would.
function processQueue() {
  return undiciFetch(`${serverBaseUrl}/api/campaigns/process-queue`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
  });
}

const openDetail = async (user, subject) => {
  await user.click(await screen.findByRole('button', { name: subject }));
  return screen.findByRole('heading', { name: subject });
};

describe('CampaignsTab — loading real campaigns', () => {
  it('lists campaigns that really exist in Postgres', async () => {
    await seedCampaign({ subject: 'Real Draft', tags: ['newsletter'] });
    await seedCampaign({ subject: 'Real Sent', status: 'sent' });

    render(<CampaignsTab />);

    expect(await screen.findByRole('button', { name: 'Real Draft' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Real Sent' })).toBeInTheDocument();
  });

  it('shows the empty state against a genuinely empty table', async () => {
    render(<CampaignsTab />);
    expect(await screen.findByText('No campaigns yet.')).toBeInTheDocument();
  });

  it('reports real recipient counts from the join', async () => {
    const contact = await seedContact({ firstName: 'Jane', email: 'jane@example.com' });
    const campaign = await seedCampaign({ subject: 'Counted', status: 'sent' });
    await pool.query(
      `INSERT INTO campaign_recipients (campaign_id, contact_id, status) VALUES ($1, $2, 'sent')`,
      [campaign.id, contact.id]
    );

    render(<CampaignsTab />);
    await screen.findByRole('button', { name: 'Counted' });

    const row = screen.getByRole('button', { name: 'Counted' }).closest('tr');
    expect(within(row).getByText('1 / 0')).toBeInTheDocument();
  });
});

describe('CampaignsTab — creating and editing real drafts', () => {
  it('creates a real campaign row', async () => {
    const user = userEvent.setup();
    render(<CampaignsTab />);
    await screen.findByText('No campaigns yet.');

    await user.click(screen.getByRole('button', { name: 'New Campaign' }));
    await user.type(screen.getByPlaceholderText(/exclusive summer travel deals/i), 'Autumn Sale');
    await user.type(screen.getByPlaceholderText(/newsletter, bahamas-interest/i), 'vip, newsletter');
    await user.type(screen.getByPlaceholderText('<p>Hi there...</p>'), '<p>Real body</p>');
    await user.click(screen.getByRole('button', { name: 'Save Draft' }));

    // Saving closes the form and re-fetches the list. Waiting for the new
    // row to render keeps that refresh inside the test — asserting only on
    // Postgres lets it land afterwards, which React flags as an update not
    // wrapped in act(...).
    await screen.findByRole('button', { name: 'Autumn Sale' });

    const { rows } = await pool.query('SELECT * FROM campaigns');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      subject: 'Autumn Sale',
      html_body: '<p>Real body</p>',
      filter_tags: ['vip', 'newsletter'],
      status: 'draft',
    });
  });

  it('round-trips html_body through edit without blanking it', async () => {
    // The list endpoint omits html_body; the form re-fetches the full record
    // to avoid saving an empty body over real content.
    const user = userEvent.setup();
    const campaign = await seedCampaign({ subject: 'Editable', htmlBody: '<p>Original body</p>' });

    render(<CampaignsTab />);
    await screen.findByRole('button', { name: 'Editable' });

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await waitFor(() => {
      expect(screen.getByPlaceholderText('<p>Hi there...</p>')).toHaveValue('<p>Original body</p>');
    });

    await user.clear(screen.getByPlaceholderText(/exclusive summer travel deals/i));
    await user.type(screen.getByPlaceholderText(/exclusive summer travel deals/i), 'Edited Subject');
    await user.click(screen.getByRole('button', { name: 'Save Draft' }));

    // See the note in 'creates a real campaign row': wait for the refreshed
    // list rather than the database, so the post-save re-fetch settles here.
    await screen.findByRole('button', { name: 'Edited Subject' });

    const { rows } = await pool.query('SELECT * FROM campaigns WHERE id = $1', [campaign.id]);
    expect(rows[0].html_body).toBe('<p>Original body</p>');
  });

  it('deletes a real draft row', async () => {
    const user = userEvent.setup();
    await seedCampaign({ subject: 'Doomed' });

    render(<CampaignsTab />);
    await screen.findByRole('button', { name: 'Doomed' });

    await user.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(async () => {
      const { rows } = await pool.query('SELECT * FROM campaigns');
      expect(rows).toHaveLength(0);
    });
  });

  it('refuses to delete a sent campaign, and the row survives', async () => {
    const user = userEvent.setup();
    const campaign = await seedCampaign({ subject: 'Already Sent', status: 'sent' });

    render(<CampaignsTab />);
    await screen.findByRole('button', { name: 'Already Sent' });

    // The UI hides Delete for non-drafts, so go at the route directly — the
    // server must enforce this too, not just the button.
    const res = await undiciFetch(`${serverBaseUrl}/api/campaigns/${campaign.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    expect(res.status).toBe(400);
    const { rows } = await pool.query('SELECT * FROM campaigns WHERE id = $1', [campaign.id]);
    expect(rows).toHaveLength(1);
  });

  it('records created_by as the logged-in admin', async () => {
    // campaigns.js previously read `req.admin`, but authMiddleware assigns
    // `req.user` — so created_by was silently null on every campaign. The
    // token carries `username` only, so that's what lands here.
    const user = userEvent.setup();
    render(<CampaignsTab />);
    await screen.findByText('No campaigns yet.');

    await user.click(screen.getByRole('button', { name: 'New Campaign' }));
    await user.type(screen.getByPlaceholderText(/exclusive summer travel deals/i), 'Who Made This');
    await user.type(screen.getByPlaceholderText('<p>Hi there...</p>'), '<p>x</p>');
    await user.click(screen.getByRole('button', { name: 'Save Draft' }));

    await screen.findByRole('button', { name: 'Who Made This' });

    const { rows } = await pool.query('SELECT created_by FROM campaigns');
    expect(rows[0].created_by).toBe(ADMIN_USERNAME);
  });
});

describe('CampaignsTab — audience preview against real contacts', () => {
  it('counts only contacts matching the campaign tags', async () => {
    const user = userEvent.setup();
    await seedContact({ firstName: 'Vip', email: 'vip@example.com', tags: ['vip'] });
    await seedContact({ firstName: 'News', email: 'news@example.com', tags: ['newsletter'] });
    await seedContact({ firstName: 'Other', email: 'other@example.com', tags: ['other'] });
    await seedCampaign({ subject: 'Tagged', tags: ['vip', 'newsletter'] });

    render(<CampaignsTab />);
    await openDetail(user, 'Tagged');

    await user.click(screen.getByRole('button', { name: /preview audience size/i }));

    expect(await screen.findByText('2 contact(s) match')).toBeInTheDocument();
  });

  it('excludes do_not_email contacts and contacts without an email', async () => {
    const user = userEvent.setup();
    await seedContact({ firstName: 'Ok', email: 'ok@example.com', tags: ['vip'] });
    await seedContact({ firstName: 'Optout', email: 'optout@example.com', tags: ['vip'], doNotEmail: true });
    await seedContact({ firstName: 'Noemail', email: null, tags: ['vip'] });
    await seedCampaign({ subject: 'Filtered', tags: ['vip'] });

    render(<CampaignsTab />);
    await openDetail(user, 'Filtered');

    await user.click(screen.getByRole('button', { name: /preview audience size/i }));

    // Only 'Ok' is reachable — this is the filter that keeps the business
    // out of trouble, so it's asserted against real SQL rather than a stub.
    expect(await screen.findByText('1 contact(s) match')).toBeInTheDocument();
  });

  it('treats an empty tag list as "all eligible contacts"', async () => {
    const user = userEvent.setup();
    await seedContact({ firstName: 'A', email: 'a@example.com', tags: ['x'] });
    await seedContact({ firstName: 'B', email: 'b@example.com', tags: [] });
    await seedContact({ firstName: 'C', email: 'c@example.com', tags: ['y'], doNotEmail: true });
    await seedCampaign({ subject: 'Broadcast', tags: [] });

    render(<CampaignsTab />);
    await openDetail(user, 'Broadcast');

    await user.click(screen.getByRole('button', { name: /preview audience size/i }));

    expect(await screen.findByText('2 contact(s) match')).toBeInTheDocument();
  });
});

describe('CampaignsTab — queueing a real send', () => {
  it('creates real recipient rows from the campaign tags and flips it to queued', async () => {
    const user = userEvent.setup();
    await seedContact({ firstName: 'Vip', email: 'vip@example.com', tags: ['vip'] });
    await seedContact({ firstName: 'Other', email: 'other@example.com', tags: ['other'] });
    const campaign = await seedCampaign({ subject: 'Queue Me', tags: ['vip'] });

    const { unmount } = render(<CampaignsTab />);
    await openDetail(user, 'Queue Me');

    await user.click(screen.getByRole('button', { name: 'Send Now' }));

    // Wait for the UI to actually reflect the send before moving on, so the
    // component's own post-send updates (fetchCampaigns + openDetail) land
    // inside the test rather than after it.
    await screen.findByText(/queued — sending will begin shortly/i);

    // Then unmount. A queued campaign starts a 4s status poll; leaving it
    // mounted through the slower database assertions below means it fires
    // with no act() wrapper, which React reports as a warning.
    unmount();

    await waitFor(async () => {
      const { rows } = await pool.query('SELECT status FROM campaigns WHERE id = $1', [campaign.id]);
      expect(rows[0].status).toBe('queued');
    });

    const { rows } = await pool.query(
      `SELECT c.email, cr.status FROM campaign_recipients cr
       JOIN contacts c ON c.id = cr.contact_id WHERE cr.campaign_id = $1`,
      [campaign.id]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ email: 'vip@example.com', status: 'pending' });
  });

  it('queues only the hand-picked contacts in manual mode', async () => {
    const user = userEvent.setup();
    await seedContact({ firstName: 'Jane', email: 'jane@example.com', tags: ['vip'] });
    await seedContact({ firstName: 'Bob', email: 'bob@example.com', tags: ['vip'] });
    const campaign = await seedCampaign({ subject: 'Manual Send', tags: ['vip'] });

    render(<CampaignsTab />);
    await openDetail(user, 'Manual Send');

    await user.click(screen.getByRole('radio', { name: /select specific contacts/i }));
    await screen.findByText('jane@example.com');

    // Tick only Jane, even though the tag would have matched both.
    const janeRow = screen.getByText('jane@example.com').closest('label');
    await user.click(within(janeRow).getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: /send to 1 selected/i }));

    await waitFor(async () => {
      const { rows } = await pool.query('SELECT * FROM campaign_recipients WHERE campaign_id = $1', [campaign.id]);
      expect(rows).toHaveLength(1);
    });

    const { rows } = await pool.query(
      `SELECT c.email FROM campaign_recipients cr
       JOIN contacts c ON c.id = cr.contact_id WHERE cr.campaign_id = $1`,
      [campaign.id]
    );
    expect(rows[0].email).toBe('jane@example.com');
  });

  it('will not queue a do_not_email contact even when picked by hand', async () => {
    const optOut = await seedContact({
      firstName: 'Optout', email: 'optout@example.com', tags: ['vip'], doNotEmail: true,
    });
    const campaign = await seedCampaign({ subject: 'Override Attempt', tags: ['vip'] });

    // The UI never offers this contact, so post the id directly — the
    // server's filter must hold regardless of what the client sends.
    const res = await undiciFetch(`${serverBaseUrl}/api/campaigns/${campaign.id}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ contactIds: [optOut.id] }),
    });

    expect(res.status).toBe(400);
    const { rows } = await pool.query('SELECT * FROM campaign_recipients');
    expect(rows).toHaveLength(0);
  });

  it('refuses to queue when no contact matches the tags, and stays a draft', async () => {
    const user = userEvent.setup();
    await seedContact({ firstName: 'Nobody', email: 'nobody@example.com', tags: ['unrelated'] });
    const campaign = await seedCampaign({ subject: 'No Audience', tags: ['vip'] });

    render(<CampaignsTab />);
    await openDetail(user, 'No Audience');

    await user.click(screen.getByRole('button', { name: 'Send Now' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/no eligible contacts/i);
    const { rows } = await pool.query('SELECT status FROM campaigns WHERE id = $1', [campaign.id]);
    expect(rows[0].status).toBe('draft');
  });

  it('refuses to queue a campaign that was already sent', async () => {
    const campaign = await seedCampaign({ subject: 'Done Already', tags: [], status: 'sent' });
    await seedContact({ firstName: 'Someone', email: 'someone@example.com', tags: [] });

    const res = await undiciFetch(`${serverBaseUrl}/api/campaigns/${campaign.id}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/already been sent/i);
  });
});

describe('CampaignsTab — the send worker', () => {
  it('sends to each queued recipient and marks the campaign sent', async () => {
    await seedContact({ firstName: 'Jane', email: 'jane@example.com', tags: ['vip'] });
    await seedContact({ firstName: 'Bob', email: 'bob@example.com', tags: ['vip'] });
    const campaign = await seedCampaign({ subject: 'Worker Run', tags: ['vip'] });

    // Queued through the API rather than the UI: what's under test here is
    // the worker, and the UI path is already covered above. Not rendering
    // means no mounted component polling every 4s while the worker runs.
    await undiciFetch(`${serverBaseUrl}/api/campaigns/${campaign.id}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({}),
    });

    await processQueue();

    const { rows } = await pool.query(
      'SELECT status FROM campaign_recipients WHERE campaign_id = $1',
      [campaign.id]
    );
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.status === 'sent')).toBe(true);

    const { rows: after } = await pool.query('SELECT status, sent_at FROM campaigns WHERE id = $1', [campaign.id]);
    expect(after[0].status).toBe('sent');
    expect(after[0].sent_at).not.toBeNull();

    expect(mailerModule.sendMail).toHaveBeenCalledTimes(2);
  });

  it('appends an unsubscribe link to the body it sends', async () => {
    const contact = await seedContact({ firstName: 'Jane', email: 'jane@example.com', tags: ['vip'] });
    const campaign = await seedCampaign({ subject: 'With Footer', htmlBody: '<p>Body text</p>', tags: ['vip'] });

    await undiciFetch(`${serverBaseUrl}/api/campaigns/${campaign.id}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({}),
    });
    await processQueue();

    const sentHtml = mailerModule.sendMail.mock.calls[0][0].html;
    expect(sentHtml).toContain('<p>Body text</p>');
    expect(sentHtml).toContain('Unsubscribe');
    expect(sentHtml).toContain(contact.unsubscribe_token);
  });

  it('records a per-recipient failure without failing the whole batch', async () => {
    await seedContact({ firstName: 'Good', email: 'good@example.com', tags: ['vip'] });
    await seedContact({ firstName: 'Bad', email: 'bad@example.com', tags: ['vip'] });
    const campaign = await seedCampaign({ subject: 'Partial Failure', tags: ['vip'] });

    await undiciFetch(`${serverBaseUrl}/api/campaigns/${campaign.id}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({}),
    });

    // The worker logs 'Campaign N send failed for recipient M' on this path
    // by design. Silenced for this test only, and restored immediately, so
    // genuine unexpected errors elsewhere still reach the output.
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // One address bounces; the other must still go out.
    mailerModule.sendMail.mockImplementation(async ({ to }) => {
      if (to === 'bad@example.com') throw new Error('Mailbox unavailable');
    });

    await processQueue();

    errorSpy.mockRestore();

    const { rows } = await pool.query(
      `SELECT c.email, cr.status, cr.error FROM campaign_recipients cr
       JOIN contacts c ON c.id = cr.contact_id
       WHERE cr.campaign_id = $1 ORDER BY c.email`,
      [campaign.id]
    );
    expect(rows).toEqual([
      expect.objectContaining({ email: 'bad@example.com', status: 'failed', error: 'Mailbox unavailable' }),
      expect.objectContaining({ email: 'good@example.com', status: 'sent', error: null }),
    ]);
  });

  it('shows real sent/failed results back in the UI', async () => {
    const user = userEvent.setup();
    await seedContact({ firstName: 'Jane', email: 'jane@example.com', tags: ['vip'] });
    const campaign = await seedCampaign({ subject: 'Visible Result', tags: ['vip'] });

    await undiciFetch(`${serverBaseUrl}/api/campaigns/${campaign.id}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({}),
    });
    await processQueue();

    render(<CampaignsTab />);
    await openDetail(user, 'Visible Result');

    expect(await screen.findByRole('heading', { name: /recipients \(1\)/i })).toBeInTheDocument();

    // "sent" appears twice on this panel — once as the campaign's status
    // badge, once as this recipient's row status — so scope to the row.
    const recipientRow = screen.getByText('jane@example.com').closest('tr');
    expect(within(recipientRow).getByText('sent')).toBeInTheDocument();
  });
});

describe('CampaignsTab — auth', () => {
  it('rejects every campaigns route without a token', async () => {
    const campaign = await seedCampaign({ subject: 'Guarded' });

    const routes = [
      ['GET', `/api/campaigns`],
      ['GET', `/api/campaigns/${campaign.id}`],
      ['GET', `/api/campaigns/available-contacts`],
      ['GET', `/api/campaigns/${campaign.id}/preview-recipients`],
      ['POST', `/api/campaigns/${campaign.id}/send`],
      ['DELETE', `/api/campaigns/${campaign.id}`],
    ];

    for (const [method, route] of routes) {
      const res = await undiciFetch(`${serverBaseUrl}${route}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        ...(method === 'POST' ? { body: '{}' } : {}),
      });
      expect(res.status, `${method} ${route}`).toBe(401);
    }
  });
});