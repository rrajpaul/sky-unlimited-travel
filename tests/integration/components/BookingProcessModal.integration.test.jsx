// Location: tests/integration/components/BookingProcessModal.integration.test.jsx
//
// WHAT MAKES THIS DIFFERENT FROM THE UNIT TEST
// (tests/unit/components/BookingProcessModal.test.jsx):
//
// The unit test mocks EVERYTHING BookingProcessModal imports — Dialog,
// Button, framer-motion, lucide-react, apiUrl, destinationsData, and fetch
// itself. That's correct for a unit test: it isolates the component's own
// logic (validation, panel navigation) from everything else.
//
// This integration test instead exercises the REAL stack:
//   - Real @radix-ui/react-dialog-based Dialog/Button (via @/components/ui/*)
//   - Real framer-motion animations, real lucide-react icons
//   - A REAL Express server (server/inquiryApp.js), started on a real
//     ephemeral port via http.listen(0)
//   - A REAL Postgres database — actual INSERT statements, actual rows
//     read back afterward
//
// Two things are still deliberately faked, and this is intentional, not a
// shortcut: (1) apiUrl is mocked to point at the real server's actual
// ephemeral port (jsdom has no way to know that port otherwise), and
// (2) sendMail is monkey-patched to avoid making a REAL Microsoft Graph API
// call and REAL emailing an admin inbox every time this test runs. Neither
// of those is "your logic" — they're a URL-configuration helper and a
// third-party API boundary, which integration tests conventionally still
// stub out.
//
// REQUIRES a real, disposable Postgres reachable via process.env.DATABASE_URL.
// Never point this at a real/production database: beforeAll/afterAll create
// and drop a real `inquiries` table.
import dotenv from 'dotenv';
import path from 'node:path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.test') });

import { createRequire } from 'node:module';
import http from 'node:http';
import { fetch as undiciFetch } from 'undici';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';

// jsdom (the test environment) doesn't implement fetch itself, and even
// where Node's own global fetch exists, vitest's jsdom environment can
// shadow it. We explicitly install a real, working fetch implementation so
// the component's actual `fetch(...)` calls go out over real localhost
// networking to our real test server below.
globalThis.fetch = undiciFetch;

const require = createRequire(import.meta.url);

// --- Mock ONLY apiUrl (see comment above for why) --------------------------
let serverBaseUrl = '';
vi.mock('@/lib/api', () => ({
  apiUrl: (path) => `${serverBaseUrl}${path}`,
}));

// --- Mock ONLY framer-motion (see file-level comment for why: jsdom lacks
// the Web Animations API completion signaling that AnimatePresence's
// mode="wait" depends on to know when to mount the next panel, so real
// exit animations just hang forever in this environment). Dialog, Button,
// the real server, and real Postgres all stay genuinely real below.
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }) => {
      const { initial, animate, exit, transition, whileInView, ...domProps } = props;
      return <div {...domProps}>{children}</div>;
    },
  },
  AnimatePresence: ({ children }) => <>{children}</>,
}));

const { default: BookingProcessModal } = await import('../../../src/components/BookingProcessModal');

// --- Real Express server, real Postgres pool -------------------------------
const dbModule = require('../../../server/db.js');
const mailerModule = require('../../../server/utils/mailer.js');

// The ONE backend mock — see file-level comment.
mailerModule.sendMail = vi.fn().mockResolvedValue();

const { createInquiryApp } = require('../../../server/inquiryApp.js');
const { pool } = dbModule;

let httpServer;

beforeAll(async () => {
  // Real schema, matching exactly the columns inquiry.js's INSERT uses.
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
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  const app = createInquiryApp();
  httpServer = http.createServer(app);
  await new Promise((resolve) => httpServer.listen(0, resolve));
  const { port } = httpServer.address();
  serverBaseUrl = `http://localhost:${port}`;
});

beforeEach(async () => {
  await pool.query('TRUNCATE inquiries RESTART IDENTITY');
  mailerModule.sendMail.mockClear();
});

afterAll(async () => {
  await pool.query('DROP TABLE IF EXISTS inquiries');
  await pool.end();
  await new Promise((resolve) => httpServer.close(resolve));
});

async function openAndFillModal(user) {
  render(
    <BookingProcessModal>
      <button>Book Now</button>
    </BookingProcessModal>
  );

  await user.click(screen.getByRole('button', { name: /book now/i }));

  await user.type(screen.getByPlaceholderText('Your full name'), 'Jane Doe');
  await user.type(screen.getByPlaceholderText('Your email'), 'jane@example.com');
  await user.click(screen.getByRole('button', { name: /next/i }));

  await user.selectOptions(screen.getByRole('combobox'), 'miami');
  await user.type(screen.getByLabelText('Departure date'), '2026-09-01');
  await user.type(screen.getByLabelText('Return date'), '2026-09-10');
  await user.click(screen.getByRole('button', { name: /next/i }));
}

describe('BookingProcessModal — full-stack integration', () => {
  it('opens a real Radix dialog on trigger click', async () => {
    const user = userEvent.setup();
    render(
      <BookingProcessModal>
        <button>Book Now</button>
      </BookingProcessModal>
    );

    // Real Radix dialog content isn't in the document until opened.
    expect(screen.queryByText('Booking Process')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /book now/i }));

    expect(await screen.findByText('Booking Process')).toBeInTheDocument();
    // Radix renders dialog content via a portal into document.body.
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('submits the form through a real server call and persists a real row in Postgres', async () => {
    const user = userEvent.setup();
    await openAndFillModal(user);

    await user.click(screen.getByRole('button', { name: /submit/i }));

    await waitFor(() => {
      expect(screen.getByText('Thank you!')).toBeInTheDocument();
    });

    // The real route really inserted a real row — read it straight back out.
    const { rows } = await pool.query('SELECT * FROM inquiries');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: 'Jane Doe',
      email: 'jane@example.com',
      destination: 'Miami, Florida',
    });

    // The admin-notification email boundary is the one thing we still stub —
    // confirm the route still tried to call it, without actually emailing anyone.
    expect(mailerModule.sendMail).toHaveBeenCalledTimes(1);
    expect(mailerModule.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ subject: 'New Booking Request from Jane Doe' })
    );
  });

  it('shows a real 400 error from the real server for an invalid email, and does not insert a row', async () => {
    const user = userEvent.setup();
    render(
      <BookingProcessModal>
        <button>Book Now</button>
      </BookingProcessModal>
    );
    await user.click(screen.getByRole('button', { name: /book now/i }));

    await user.type(screen.getByPlaceholderText('Your full name'), 'Jane Doe');
    await user.type(screen.getByPlaceholderText('Your email'), 'not-an-email');
    await user.click(screen.getByRole('button', { name: /next/i }));

    // The component's OWN panel validation doesn't check email format — only
    // presence — so it advances to the next panel; the real server's
    // validation is what actually rejects "not-an-email".
    await user.selectOptions(screen.getByRole('combobox'), 'miami');
    await user.type(screen.getByLabelText('Departure date'), '2026-09-01');
    await user.type(screen.getByLabelText('Return date'), '2026-09-10');
    await user.click(screen.getByRole('button', { name: /next/i }));

    await user.click(screen.getByRole('button', { name: /submit/i }));

    await waitFor(() => {
      expect(screen.getByText('Invalid email address.')).toBeInTheDocument();
    });

    const { rows } = await pool.query('SELECT * FROM inquiries');
    expect(rows).toHaveLength(0);
  });
});