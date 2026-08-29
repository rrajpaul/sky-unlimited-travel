import dotenv from 'dotenv';
import path from 'node:path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.test') });

import { createRequire } from 'node:module';
import http from 'node:http';
import { fetch as undiciFetch } from 'undici';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';

globalThis.fetch = undiciFetch;

const require = createRequire(import.meta.url);

let serverBaseUrl = '';
vi.mock('@/lib/api', () => ({
  apiUrl: (path) => `${serverBaseUrl}${path}`,
}));

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

const dbModule = require('../../../server/db.js');
const mailerModule = require('../../../server/utils/mailer.js');

mailerModule.sendMail = vi.fn().mockResolvedValue();

const { createInquiryApp } = require('../../../server/inquiryApp.js');
const { pool } = dbModule;

let httpServer;

beforeAll(async () => {
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

// Restores any vi.spyOn from an individual test (e.g. the console.error
// silence below) so it can't leak into later tests in this file. Note this
// does NOT touch mailerModule.sendMail — that's a plain assignment rather
// than a spy, so it survives and stays stubbed for the whole file.
afterEach(() => {
  vi.restoreAllMocks();
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

    expect(screen.queryByText('Booking Process')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /book now/i }));

    expect(await screen.findByText('Booking Process')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('submits the form through a real server call and persists a real row in Postgres', async () => {
    const user = userEvent.setup();
    await openAndFillModal(user);

    await user.click(screen.getByRole('button', { name: /submit/i }));

    await waitFor(() => {
      expect(screen.getByText('Thank you!')).toBeInTheDocument();
    });

    const { rows } = await pool.query('SELECT * FROM inquiries');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: 'Jane Doe',
      email: 'jane@example.com',
      destination: 'Miami, Florida',
    });

    expect(mailerModule.sendMail).toHaveBeenCalledTimes(1);
    expect(mailerModule.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ subject: 'New Booking Request from Jane Doe' })
    );
  });

  it('shows a real 400 error from the real server for an invalid email, and does not insert a row', async () => {
    // The component logs 'Inquiry capture failed:' when the real server
    // rejects this. Silence it here only, so genuine unexpected errors
    // elsewhere in the suite still reach the output.
    vi.spyOn(console, 'error').mockImplementation(() => {});

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