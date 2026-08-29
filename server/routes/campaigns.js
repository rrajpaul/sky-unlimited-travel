const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const requireAdmin = require('../auth/authMiddleware');
const { sendMail } = require('../utils/mailer');

// GET all campaigns (admin only) — includes recipient/send counts
router.get('/', requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        c.id, c.subject, c.status, c.filter_tags, c.created_by, c.created_at, c.sent_at,
        COUNT(cr.id) FILTER (WHERE cr.id IS NOT NULL) AS recipient_count,
        COUNT(cr.id) FILTER (WHERE cr.status = 'sent') AS sent_count,
        COUNT(cr.id) FILTER (WHERE cr.status = 'failed') AS failed_count
      FROM campaigns c
      LEFT JOIN campaign_recipients cr ON cr.campaign_id = c.id
      GROUP BY c.id
      ORDER BY c.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Fetch campaigns error:', err);
    res.status(500).json({ error: 'Failed to fetch campaigns' });
  }
});

// GET all contacts eligible to receive campaign emails, regardless of any
// campaign's filter_tags — used by the admin UI to build a manual
// recipient picker (e.g. for testing a send against a couple of people
// instead of an entire tag-filtered audience).
// IMPORTANT: registered before GET /:id so 'available-contacts' isn't
// swallowed by the :id param route.
router.get('/available-contacts', requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, first_name, last_name, email, tags
       FROM contacts
       WHERE do_not_email = false AND email IS NOT NULL
       ORDER BY first_name, last_name`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Fetch available contacts error:', err);
    res.status(500).json({ error: 'Failed to fetch available contacts' });
  }
});

// GET a single campaign, with its recipients and their statuses (admin only)
router.get('/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const campaignResult = await pool.query('SELECT * FROM campaigns WHERE id = $1', [id]);
    const campaign = campaignResult.rows[0];
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    const recipientsResult = await pool.query(
      `SELECT cr.id, cr.status, cr.error, cr.sent_at,
              c.id AS contact_id, c.first_name, c.last_name, c.email
       FROM campaign_recipients cr
       JOIN contacts c ON c.id = cr.contact_id
       WHERE cr.campaign_id = $1
       ORDER BY cr.id`,
      [id]
    );

    res.json({ ...campaign, recipients: recipientsResult.rows });
  } catch (err) {
    console.error('Fetch campaign error:', err);
    res.status(500).json({ error: 'Failed to fetch campaign' });
  }
});

// POST create a new draft campaign (admin only)
router.post('/', requireAdmin, async (req, res) => {
  const { subject, htmlBody, filterTags } = req.body;

  if (!subject?.trim() || !htmlBody?.trim()) {
    return res.status(400).json({ error: 'Subject and HTML body are required.' });
  }

  const tags = Array.isArray(filterTags) ? filterTags.filter((t) => t && t.trim()) : [];

  try {
    const result = await pool.query(
      `INSERT INTO campaigns (subject, html_body, filter_tags, created_by)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      // authMiddleware assigns the decoded token to req.user (not req.admin),
      // so reading req.admin here silently recorded created_by as null for
      // every campaign. The token currently carries only `username`; the
      // email fallback is kept in case it's added to the payload later.
      [subject.trim(), htmlBody, tags, req.user?.email || req.user?.username || null]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Create campaign error:', err);
    res.status(500).json({ error: 'Failed to create campaign' });
  }
});

// PATCH update a draft campaign (admin only) — only while status = 'draft'
router.patch('/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { subject, htmlBody, filterTags } = req.body;

  try {
    const existing = await pool.query('SELECT status FROM campaigns WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Campaign not found' });
    }
    if (existing.rows[0].status !== 'draft') {
      return res.status(400).json({ error: 'Only draft campaigns can be edited.' });
    }
    if (!subject?.trim() || !htmlBody?.trim()) {
      return res.status(400).json({ error: 'Subject and HTML body are required.' });
    }

    const tags = Array.isArray(filterTags) ? filterTags.filter((t) => t && t.trim()) : [];

    const result = await pool.query(
      `UPDATE campaigns
       SET subject = $1, html_body = $2, filter_tags = $3
       WHERE id = $4
       RETURNING *`,
      [subject.trim(), htmlBody, tags, id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Update campaign error:', err);
    res.status(500).json({ error: 'Failed to update campaign' });
  }
});

// DELETE a draft campaign (admin only) — only while status = 'draft'
router.delete('/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const existing = await pool.query('SELECT status FROM campaigns WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Campaign not found' });
    }
    if (existing.rows[0].status !== 'draft') {
      return res.status(400).json({ error: 'Only draft campaigns can be deleted.' });
    }

    await pool.query('DELETE FROM campaigns WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Delete campaign error:', err);
    res.status(500).json({ error: 'Failed to delete campaign' });
  }
});

// Helper: find contacts eligible for a given filter_tags array.
// Empty filter_tags = broadcast to all eligible contacts (no tag restriction).
// do_not_email = true and missing email are always excluded.
async function getEligibleContacts(filterTags) {
  if (!filterTags || filterTags.length === 0) {
    const result = await pool.query(
      `SELECT id, first_name, last_name, email, unsubscribe_token
       FROM contacts
       WHERE do_not_email = false AND email IS NOT NULL`
    );
    return result.rows;
  }

  const result = await pool.query(
    `SELECT id, first_name, last_name, email, unsubscribe_token
     FROM contacts
     WHERE do_not_email = false AND email IS NOT NULL AND tags && $1::text[]`,
    [filterTags]
  );
  return result.rows;
}

// GET a live preview of who a campaign would currently reach, without
// writing any campaign_recipients rows (admin only). Useful for showing
// an audience count before committing to send.
router.get('/:id/preview-recipients', requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const campaignResult = await pool.query('SELECT filter_tags FROM campaigns WHERE id = $1', [id]);
    const campaign = campaignResult.rows[0];
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    const contacts = await getEligibleContacts(campaign.filter_tags);
    res.json({ count: contacts.length, contacts });
  } catch (err) {
    console.error('Preview recipients error:', err);
    res.status(500).json({ error: 'Failed to preview recipients' });
  }
});

// POST send a campaign (admin only).
// Helper: fetch specific contacts by ID for a targeted/manual send,
// still enforcing the same safety filters (do_not_email, email present)
// as the tag-based path — a manual pick can't override those.
async function getContactsByIds(contactIds) {
  if (!Array.isArray(contactIds) || contactIds.length === 0) return [];

  const result = await pool.query(
    `SELECT id, first_name, last_name, email, unsubscribe_token
     FROM contacts
     WHERE do_not_email = false AND email IS NOT NULL AND id = ANY($1::int[])`,
    [contactIds]
  );
  return result.rows;
}

// POST enqueue a campaign for sending (admin only).
// Builds the recipient list from filter_tags, inserts campaign_recipients
// rows as 'pending' (idempotent via the unique constraint), and flips the
// campaign to 'queued'. Returns immediately — actual sending happens in
// the background worker below, so this responds fast regardless of list size.
router.post('/:id/send', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { contactIds } = req.body || {};

  try {
    const campaignResult = await pool.query('SELECT * FROM campaigns WHERE id = $1', [id]);
    const campaign = campaignResult.rows[0];
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }
    if (campaign.status !== 'draft') {
      return res.status(400).json({
        error: campaign.status === 'sent'
          ? 'This campaign has already been sent.'
          : `Campaign is currently ${campaign.status}.`,
      });
    }

    // If specific contactIds are provided, send only to those (e.g. for
    // testing) — otherwise fall back to the campaign's filter_tags.
    const contacts = Array.isArray(contactIds) && contactIds.length > 0
      ? await getContactsByIds(contactIds)
      : await getEligibleContacts(campaign.filter_tags);

    if (contacts.length === 0) {
      return res.status(400).json({
        error: Array.isArray(contactIds) && contactIds.length > 0
          ? 'None of the selected contacts are eligible to receive email (check do_not_email / missing email).'
          : "No eligible contacts match this campaign's filters.",
      });
    }

    for (const contact of contacts) {
      await pool.query(
        `INSERT INTO campaign_recipients (campaign_id, contact_id, status)
         VALUES ($1, $2, 'pending')
         ON CONFLICT (campaign_id, contact_id) DO NOTHING`,
        [id, contact.id]
      );
    }

    // 'queued' means recipients are staged but the worker hasn't picked
    // them up yet; the worker flips this to 'sending' once it starts
    // processing this campaign's batch.
    await pool.query(`UPDATE campaigns SET status = 'queued' WHERE id = $1`, [id]);

    res.json({ ok: true, queuedCount: contacts.length });
  } catch (err) {
    console.error('Queue campaign error:', err);
    res.status(500).json({ error: 'Failed to queue campaign' });
  }
});

// --- Background send worker ---------------------------------------------
//
// Runs on an interval inside this Node process and sends a small batch of
// pending campaign_recipients each tick, across whichever campaigns are
// 'queued' or 'sending'. This keeps individual HTTP requests fast and
// avoids gateway/proxy timeouts on large recipient lists.
//
// Trade-off: this worker only runs while this process is alive. If the
// server restarts mid-send, any 'pending' rows are untouched (safe — the
// unique constraint means re-processing is idempotent) but the campaign
// stays 'sending' until this process (or another instance of it) comes
// back up and resumes. If you run multiple server instances, only one
// should run this worker, or you'll get duplicate-send races — move this
// to a dedicated worker process/queue (e.g. BullMQ, pg-boss) if you scale
// past a single instance.

const CAMPAIGN_BATCH_SIZE = parseInt(process.env.CAMPAIGN_BATCH_SIZE || '20', 10);
const CAMPAIGN_POLL_INTERVAL_MS = parseInt(process.env.CAMPAIGN_POLL_INTERVAL_MS || '15000', 10);
const CAMPAIGN_SEND_DELAY_MS = parseInt(process.env.CAMPAIGN_SEND_DELAY_MS || '150', 10);

let isProcessingQueue = false;

async function processCampaignQueueBatch() {
  if (isProcessingQueue) return; // don't overlap runs if a batch is still working
  isProcessingQueue = true;

  try {
    const pendingResult = await pool.query(
      `SELECT cr.id AS recipient_id, cr.campaign_id, c.first_name, c.email, c.unsubscribe_token,
              camp.subject, camp.html_body
       FROM campaign_recipients cr
       JOIN contacts c ON c.id = cr.contact_id
       JOIN campaigns camp ON camp.id = cr.campaign_id
       WHERE cr.status = 'pending' AND camp.status IN ('queued', 'sending')
       ORDER BY cr.id
       LIMIT $1`,
      [CAMPAIGN_BATCH_SIZE]
    );

    if (pendingResult.rows.length === 0) return;

    // Flip any 'queued' campaigns touched in this batch to 'sending' so the
    // UI reflects that sending has actually started.
    const campaignIds = [...new Set(pendingResult.rows.map((r) => r.campaign_id))];
    await pool.query(
      `UPDATE campaigns SET status = 'sending' WHERE id = ANY($1::int[]) AND status = 'queued'`,
      [campaignIds]
    );

    for (const row of pendingResult.rows) {
      // Requires PUBLIC_BASE_URL to be set, and a public GET /unsubscribe/:token
      // route to actually process unsubscribes — that route doesn't exist yet
      // in what you've shared, so add it before relying on this link.
      const unsubscribeUrl = `${process.env.PUBLIC_BASE_URL || ''}/unsubscribe/${row.unsubscribe_token}`;

      const htmlWithFooter = `
        ${row.html_body}
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 32px 0 16px;" />
        <p style="color: #9ca3af; font-size: 12px; text-align: center;">
          <a href="${unsubscribeUrl}" style="color: #9ca3af;">Unsubscribe</a> from future emails.
        </p>
      `;

      try {
        await sendMail({
          to: row.email,
          subject: row.subject,
          html: htmlWithFooter,
        });

        await pool.query(
          `UPDATE campaign_recipients SET status = 'sent', sent_at = NOW(), error = NULL WHERE id = $1`,
          [row.recipient_id]
        );
      } catch (err) {
        console.error(`Campaign ${row.campaign_id} send failed for recipient ${row.recipient_id}:`, err);
        await pool.query(
          `UPDATE campaign_recipients SET status = 'failed', error = $1 WHERE id = $2`,
          [(err.message || 'Unknown error').slice(0, 500), row.recipient_id]
        );
      }

      await new Promise((resolve) => setTimeout(resolve, CAMPAIGN_SEND_DELAY_MS));
    }

    // Any campaign that's 'sending' with no 'pending' recipients left is done.
    await pool.query(`
      UPDATE campaigns
      SET status = 'sent', sent_at = NOW()
      WHERE status = 'sending'
        AND id NOT IN (
          SELECT DISTINCT campaign_id FROM campaign_recipients WHERE status = 'pending'
        )
    `);
  } catch (err) {
    console.error('Campaign queue processing error:', err);
  } finally {
    isProcessingQueue = false;
  }
}

// Starting these at module scope means they begin ticking as soon as
// anything requires this file — including server/app.js, and therefore every
// test file that builds the app. A test run doesn't want a live sender
// polling a test database (and would need campaigns/campaign_recipients/
// contacts tables to exist purely to keep it from erroring), so skip it
// under Vitest. Nothing else changes: outside tests both timers start
// exactly as before.
//
// A cleaner long-term shape is to export a startCampaignWorker() and call it
// from index.js alongside app.listen(), matching the split app.js already
// documents — requiring a route file wouldn't start background work at all
// then. That needs an index.js edit to avoid silently stopping sends in
// production, so it's deliberately not done here.
const IS_TEST_RUN = !!process.env.VITEST || process.env.NODE_ENV === 'test';

if (!IS_TEST_RUN) {
  setInterval(processCampaignQueueBatch, CAMPAIGN_POLL_INTERVAL_MS);
  // Run once shortly after startup too, so anything left 'queued' from
  // before a restart doesn't sit idle for a full interval.
  setTimeout(processCampaignQueueBatch, 5000);
}

// POST manually trigger a queue-processing tick right now (admin only).
// Handy for testing, or for nudging things along without waiting for the
// next interval tick.
router.post('/process-queue', requireAdmin, async (req, res) => {
  await processCampaignQueueBatch();
  res.json({ ok: true });
});

module.exports = router;