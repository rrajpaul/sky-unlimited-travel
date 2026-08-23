// Location: tests/unit/components/BookingProcessModal.test.jsx
//
// WHAT'S MOCKED AND WHY:
//
// This component pulls in a design system (@/components/ui/dialog,
// @/components/ui/button), an animation library (framer-motion), icons
// (lucide-react), an API helper (@/lib/api), and a data file
// (@/data/destinations). A unit test for THIS component shouldn't also be
// testing Radix's dialog internals or framer-motion's animation engine —
// so each of those is replaced with a minimal stand-in below. This keeps
// the test focused on BookingProcessModal's own logic: panel navigation,
// validation rules, and the submit flow.
//
// If you already have a shared test setup that mocks your design system
// consistently across many component tests, move these mocks there instead
// of repeating them per test file.

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mock the shadcn/Radix dialog primitives -------------------------------
// Real behavior we need to preserve: DialogTrigger's click should open the
// dialog, and DialogContent should only render while `open` is true. Radix's
// actual Dialog manages this via context; here we simplify by having Dialog
// clone an `open`/`onOpenChange`-aware trigger and pass `open` down directly.
vi.mock('@/components/ui/dialog', () => {
  let currentOpen = false;
  let currentOnOpenChange = () => {};

  return {
    Dialog: ({ open, onOpenChange, children }) => {
      currentOpen = open;
      currentOnOpenChange = onOpenChange;
      return <div>{children}</div>;
    },
    DialogTrigger: ({ children }) => (
      <span onClick={() => currentOnOpenChange(true)}>{children}</span>
    ),
    DialogContent: ({ children }) => (currentOpen ? <div>{children}</div> : null),
    DialogTitle: ({ children }) => <h2>{children}</h2>,
    DialogDescription: ({ children }) => <p>{children}</p>,
  };
});

// --- Mock the design-system Button -----------------------------------------
// Just a plain <button> so RTL can find it by role/name like any other button.
vi.mock('@/components/ui/button', () => ({
  Button: ({ children, ...props }) => <button {...props}>{children}</button>,
}));

// --- Mock framer-motion ------------------------------------------------------
// motion.div renders as a plain div (dropping animation-only props),
// AnimatePresence just renders its children with no exit-animation delay —
// tests don't need to wait for animations to finish.
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }) => {
      // Strip framer-motion-only props so they don't get spread onto the DOM node.
      const { initial, animate, exit, transition, whileInView, ...domProps } = props;
      return <div {...domProps}>{children}</div>;
    },
  },
  AnimatePresence: ({ children }) => <>{children}</>,
}));

// --- Mock lucide-react icons -------------------------------------------------
// Icons are purely decorative for these tests; render simple stand-ins.
vi.mock('lucide-react', () => ({
  CheckCircle2: (props) => <svg data-icon="check" {...props} />,
  Calendar: (props) => <svg data-icon="calendar" {...props} />,
  Phone: (props) => <svg data-icon="phone" {...props} />,
  CreditCard: (props) => <svg data-icon="card" {...props} />,
  ChevronRight: (props) => <svg data-icon="chevron" {...props} />,
}));

// --- Mock the API helper ------------------------------------------------------
// apiUrl just needs to return a string; the real network call is intercepted
// via global.fetch below, so the actual base URL doesn't matter here.
vi.mock('@/lib/api', () => ({
  apiUrl: (path) => `http://localhost${path}`,
}));

// --- Mock destinations data ---------------------------------------------------
// A small, fixed set so assertions don't depend on your real destinations list.
vi.mock('@/data/destinations', () => ({
  destinationsData: {
    miami: { title: 'Miami' },
    paris: { title: 'Paris' },
  },
}));

const { default: BookingProcessModal } = await import('../../../src/components/BookingProcessModal');

// Helper: opens the modal and returns to the Contact Info panel.
async function openModal(user, props = {}) {
  render(
    <BookingProcessModal {...props}>
      <button>Book Now</button>
    </BookingProcessModal>
  );
  await user.click(screen.getByRole('button', { name: /book now/i }));
}

// Helper: fills and passes the Contact Info panel (panel 0).
async function fillContactInfo(user, { name = 'Jane Doe', email = 'jane@example.com' } = {}) {
  await user.type(screen.getByPlaceholderText('Your full name'), name);
  await user.type(screen.getByPlaceholderText('Your email'), email);
  await user.click(screen.getByRole('button', { name: /next/i }));
}

// Helper: fills and passes the Destination & Dates panel (panel 1).
async function fillDestinationAndDates(user, { destinationKey = 'miami', fromDate = '2026-09-01', toDate = '2026-09-10' } = {}) {
  await user.selectOptions(screen.getByRole('combobox'), destinationKey);
  // The date inputs now have aria-labels in the component, so they can be
  // found directly by their accessible name — no more DOM traversal.
  await user.type(screen.getByLabelText('Departure date'), fromDate);
  await user.type(screen.getByLabelText('Return date'), toDate);
  await user.click(screen.getByRole('button', { name: /next/i }));
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('BookingProcessModal — opening', () => {
  it('renders the trigger and opens the dialog on click', async () => {
    const user = userEvent.setup();
    await openModal(user);

    expect(screen.getByText('Booking Process')).toBeInTheDocument();
    expect(screen.getByText('Contact Info')).toBeInTheDocument();
  });
});

describe('BookingProcessModal — Contact Info panel validation', () => {
  it('shows an error when advancing without a name or email', async () => {
    const user = userEvent.setup();
    await openModal(user);

    await user.click(screen.getByRole('button', { name: /next/i }));

    expect(screen.getByText('Full name is required')).toBeInTheDocument();
  });

  it('shows an error when email is missing but name is present', async () => {
    const user = userEvent.setup();
    await openModal(user);

    await user.type(screen.getByPlaceholderText('Your full name'), 'Jane Doe');
    await user.click(screen.getByRole('button', { name: /next/i }));

    expect(screen.getByText('Email address is required')).toBeInTheDocument();
  });

  it('advances to the Destination panel once name and email are filled', async () => {
    const user = userEvent.setup();
    await openModal(user);
    await fillContactInfo(user);

    expect(screen.getByText('Destination & Dates')).toBeInTheDocument();
  });
});

describe('BookingProcessModal — Destination & Dates panel validation', () => {
  it('shows an error when advancing without a destination', async () => {
    const user = userEvent.setup();
    await openModal(user);
    await fillContactInfo(user);

    await user.click(screen.getByRole('button', { name: /next/i }));

    expect(screen.getByText('Please select a destination')).toBeInTheDocument();
  });

  it('shows an error when the return date is before the departure date', async () => {
    const user = userEvent.setup();
    await openModal(user);
    await fillContactInfo(user);

    await user.selectOptions(screen.getByRole('combobox'), 'miami');
    await user.type(screen.getByLabelText('Departure date'), '2026-09-10');
    await user.type(screen.getByLabelText('Return date'), '2026-09-01');
    await user.click(screen.getByRole('button', { name: /next/i }));

    expect(screen.getByText('Return date must be after departure date')).toBeInTheDocument();
  });

  it('advances to the Trip Details panel with valid destination and dates', async () => {
    const user = userEvent.setup();
    await openModal(user);
    await fillContactInfo(user);
    await fillDestinationAndDates(user);

    expect(screen.getByText('Trip Details')).toBeInTheDocument();
  });
});

describe('BookingProcessModal — navigation', () => {
  it('goes back to the previous panel and preserves entered data', async () => {
    const user = userEvent.setup();
    await openModal(user);
    await fillContactInfo(user, { name: 'Jane Doe', email: 'jane@example.com' });

    expect(screen.getByText('Destination & Dates')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /back/i }));

    expect(screen.getByText('Contact Info')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Your full name')).toHaveValue('Jane Doe');
  });
});

describe('BookingProcessModal — submission', () => {
  it('submits the form and shows the success message', async () => {
    global.fetch = vi.fn()
      // First call: POST /api/inquiry
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) })
      // Second call: POST /api/inquiry/notify-admin
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });

    const user = userEvent.setup();
    await openModal(user);
    await fillContactInfo(user);
    await fillDestinationAndDates(user);

    await user.click(screen.getByRole('button', { name: /submit/i }));

    await waitFor(() => {
      expect(screen.getByText('Thank you!')).toBeInTheDocument();
    });

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      'http://localhost/api/inquiry',
      expect.objectContaining({ method: 'POST' })
    );
    expect(global.fetch).toHaveBeenNthCalledWith(
      2,
      'http://localhost/api/inquiry/notify-admin',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('shows an error message when the inquiry request fails', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({ error: 'Server exploded' }),
    });

    const user = userEvent.setup();
    await openModal(user);
    await fillContactInfo(user);
    await fillDestinationAndDates(user);

    await user.click(screen.getByRole('button', { name: /submit/i }));

    await waitFor(() => {
      expect(screen.getByText('Server exploded')).toBeInTheDocument();
    });
    // Only the first call should have happened — no admin notification on failure.
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});

describe('BookingProcessModal — initial destination prop', () => {
  it('pre-selects the destination when a destination prop is passed', async () => {
    const user = userEvent.setup();
    await openModal(user, { destination: 'paris' });
    await fillContactInfo(user);

    expect(screen.getByRole('combobox')).toHaveValue('paris');
  });
});