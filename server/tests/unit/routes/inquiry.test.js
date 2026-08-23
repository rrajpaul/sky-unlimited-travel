// Location: server/tests/unit/routes/inquiry.test.js
//
// A NOTE ON WHY THIS TEST LOOKS DIFFERENT FROM OTHERS IN THIS SUITE:
//
// server/routes/inquiry.js is CommonJS (require/module.exports), and — per
// its use of require/module.exports alongside a root package.json with
// "type": "module" — server/ needs its own package.json with
// "type": "commonjs" to parse correctly at all. Once that boundary exists,
// Vitest hands those files off to Node's own native require() rather than
// running them through its own module graph — which means vi.mock() has
// nothing to intercept; it silently does nothing here.
//
// The fix: use Node's real require() ourselves (via createRequire) to load
// the same db.js and mailer.js modules inquiry.js loads, then monkey-patch
// their exports in place. Because Node's require() caches modules by
// resolved file path, our patched pool/sendMail are the EXACT SAME objects
// inquiry.js ends up using — no interception layer needed.
//
// One ordering rule matters: sendMail is destructured by inquiry.js
// (`const { sendMail } = require(...)`), which snapshots whatever function
// is on the export at that moment. So we patch mailerModule.sendMail
// BEFORE requiring inquiryApp.js for the first time (which is what
// triggers inquiry.js's own require calls). pool.query doesn't have this
// constraint — inquiry.js always calls pool.query(...) via property access,
// so patching it can happen at any point and still take effect.
import { createRequire } from 'node:module';
import request from 'supertest';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const require = createRequire(import.meta.url);

// Paths are relative to THIS file's location: server/tests/unit/routes/.
// Three levels up (../../../) reaches server/, since this file now lives
// inside server/ itself rather than above it.
const dbModule = require('../../../db.js');
const mailerModule = require('../../../utils/mailer.js');

// Replace the real implementations with mocks BEFORE anything requires
// inquiry.js for the first time.
dbModule.pool.query = vi.fn();
mailerModule.sendMail = vi.fn();

const { createInquiryApp } = require('../../../inquiryApp.js');
const app = createInquiryApp();

const { pool } = dbModule;
const { sendMail } = mailerModule;

beforeEach(() => {
  // resetAllMocks (not clearAllMocks) — clears queued mockResolvedValueOnce/
  // mockRejectedValueOnce values too, so an unconsumed queued value from one
  // test can never leak into the next.
  vi.resetAllMocks();
});

describe('POST /api/inquiry', () => {
  it('saves a valid inquiry', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app).post('/api/inquiry').send({
      name: 'Jane Doe',
      email: 'jane@example.com',
      phone: '555-1234',
      destination: 'Miami',
      details: 'Anniversary trip',
      fromDate: '2026-09-01',
      toDate: '2026-09-10',
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    // Confirms values are trimmed and passed in the right column order —
    // catches a common bug class where params get shuffled.
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO inquiries'),
      ['Jane Doe', 'jane@example.com', '555-1234', 'Miami', 'Anniversary trip', '2026-09-01', '2026-09-10']
    );
  });

  it('trims whitespace on name before storing, and stores optional fields as null when omitted', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });

    // Note: email is NOT padded with whitespace here. The route validates
    // the email format against the raw (untrimmed) value — a padded email
    // like "  jane@example.com  " actually fails validation before it ever
    // reaches the trim/store step (worth fixing in the route: validate
    // email.trim() instead of email). This test covers what the route
    // actually does today: trimming applies to the stored name/email, but
    // only inputs that already pass the untrimmed regex get that far.
    await request(app).post('/api/inquiry').send({
      name: '  Jane Doe  ',
      email: 'jane@example.com',
      // phone, destination, details, fromDate, toDate all omitted
    });

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO inquiries'),
      ['Jane Doe', 'jane@example.com', null, null, null, null, null]
    );
  });

  it('rejects an email with leading/trailing whitespace as invalid (documents current behavior)', async () => {
    const res = await request(app).post('/api/inquiry').send({
      name: 'Jane Doe',
      email: '  jane@example.com  ',
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid email address.');
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('rejects a missing name with 400 and never touches the database', async () => {
    const res = await request(app).post('/api/inquiry').send({
      email: 'jane@example.com',
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Name and email are required.');
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('rejects a missing email with 400', async () => {
    const res = await request(app).post('/api/inquiry').send({
      name: 'Jane Doe',
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Name and email are required.');
  });

  it('rejects a name that is only whitespace', async () => {
    const res = await request(app).post('/api/inquiry').send({
      name: '   ',
      email: 'jane@example.com',
    });

    expect(res.status).toBe(400);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('rejects a malformed email with 400', async () => {
    const res = await request(app).post('/api/inquiry').send({
      name: 'Jane Doe',
      email: 'not-an-email',
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid email address.');
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('returns 500 when the database insert fails', async () => {
    pool.query.mockRejectedValueOnce(new Error('connection lost'));

    const res = await request(app).post('/api/inquiry').send({
      name: 'Jane Doe',
      email: 'jane@example.com',
    });

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Something went wrong. Please try again.');
  });
});

describe('POST /api/inquiry/notify-admin', () => {
  it('emails the admin with the inquiry details', async () => {
    sendMail.mockResolvedValueOnce();
    process.env.ADMIN_EMAIL = 'admin@skyunlimitedtravel.com';

    const res = await request(app).post('/api/inquiry/notify-admin').send({
      name: 'Jane Doe',
      email: 'jane@example.com',
      phone: '555-1234',
      destination: 'Miami',
      fromDate: '2026-09-01',
      toDate: '2026-09-10',
      details: 'Anniversary trip',
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'admin@skyunlimitedtravel.com',
        subject: 'New Booking Request from Jane Doe',
      })
    );

    // Confirms the customer's details actually made it into the email body,
    // without pinning down the exact HTML formatting.
    const emailArg = sendMail.mock.calls[0][0];
    expect(emailArg.html).toContain('jane@example.com');
    expect(emailArg.html).toContain('Miami');
  });

  it('falls back to placeholder text for missing optional fields', async () => {
    sendMail.mockResolvedValueOnce();

    await request(app).post('/api/inquiry/notify-admin').send({
      name: 'Jane Doe',
      email: 'jane@example.com',
      // phone, destination, fromDate, toDate, details all omitted
    });

    const emailArg = sendMail.mock.calls[0][0];
    expect(emailArg.html).toContain('Not provided');   // phone fallback
    expect(emailArg.html).toContain('Not specified');  // destination fallback
    expect(emailArg.html).toContain('None');           // details fallback
  });

  it('returns 500 when sending the email fails', async () => {
    sendMail.mockRejectedValueOnce(new Error('SMTP timeout'));

    const res = await request(app).post('/api/inquiry/notify-admin').send({
      name: 'Jane Doe',
      email: 'jane@example.com',
    });

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Failed to send notification');
  });
});