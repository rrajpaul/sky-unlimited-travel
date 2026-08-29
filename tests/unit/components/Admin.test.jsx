import React from 'react';
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AdminPage from '@/components/Admin';

// Icons aren't relevant to behavior — replace with lightweight stand-ins.
vi.mock('lucide-react', () => ({
  ChevronDown: () => <span data-testid="chevron-down" />,
  ChevronRight: () => <span data-testid="chevron-right" />,
}));

// Isolate AdminPage from the CRM / Campaigns tabs it renders.
vi.mock('@/components/ContactsTable', () => ({
  default: () => <div data-testid="contacts-table">Contacts Table</div>,
}));
vi.mock('@/components/CampaignsTab', () => ({
  default: () => <div data-testid="campaigns-tab">Campaigns Tab</div>,
}));

const mockRegistrations = [
  {
    id: 1,
    name: 'Jane Doe',
    email: 'jane@example.com',
    destination: 'Paris',
    phone: '555-1234',
    created_at: '2024-01-15T00:00:00.000Z',
    from_date: '2024-06-01T00:00:00.000Z',
    to_date: '2024-06-10T00:00:00.000Z',
    details: 'Honeymoon trip',
    payment_status: 'unpaid',
    payment_link_sent: null,
    payment_link_sent_at: null,
    payment_paid_at: null,
  },
  {
    id: 2,
    name: 'John Smith',
    email: 'john@example.com',
    destination: 'Tokyo',
    phone: '555-5678',
    created_at: '2024-02-20T00:00:00.000Z',
    from_date: null,
    to_date: null,
    details: null,
    payment_status: 'paid',
    payment_link_sent: '2024-02-21T00:00:00.000Z',
    payment_link_sent_at: '2024-02-21T00:00:00.000Z',
    payment_paid_at: '2024-02-25T00:00:00.000Z',
  },
];

// Helper to build a fetch Response-like resolved promise.
const jsonResponse = (body, ok = true) =>
  Promise.resolve({ ok, json: () => Promise.resolve(body) });

async function renderLoggedIn() {
  localStorage.setItem('adminToken', 'stored-token');
  global.fetch
    .mockImplementationOnce(() => jsonResponse({ valid: true })) // /api/admin/verify
    .mockImplementationOnce(() => jsonResponse(mockRegistrations)); // /api/inquiry

  const utils = render(<AdminPage />);
  // "Manage Travel Bookings" only appears once; row content like a
  // customer's name renders twice (once for the mobile card, once for
  // the desktop table), so it isn't safe to wait on here.
  await screen.findByText(/manage travel bookings/i);
  return utils;
}

describe('AdminPage', () => {
  beforeEach(() => {
    localStorage.clear();
    global.fetch = vi.fn();
    window.alert = vi.fn();
    vi.spyOn(console, 'error').mockImplementation(() => {});

    // Prevent jsdom's "not implemented: navigation" noise from handleLogout
    // and let us assert on the redirect target.
    delete window.location;
    window.location = { href: '' };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('with no stored session', () => {
    test('renders the login form', async () => {
      render(<AdminPage />);

      expect(await screen.findByRole('heading', { name: /admin login/i })).toBeInTheDocument();
      expect(screen.getByPlaceholderText(/enter your username/i)).toBeInTheDocument();
      expect(screen.getByPlaceholderText(/enter your password/i)).toBeInTheDocument();
      expect(global.fetch).not.toHaveBeenCalled();
    });

    test('blocks submission and shows a validation error when fields are empty', async () => {
      const user = userEvent.setup();
      render(<AdminPage />);
      await screen.findByRole('heading', { name: /admin login/i });

      await user.click(screen.getByRole('button', { name: /sign in/i }));

      expect(await screen.findByText(/please fill in all fields/i)).toBeInTheDocument();
      expect(global.fetch).not.toHaveBeenCalled();
    });

    test('logs in, stores the token, and loads registrations', async () => {
      const user = userEvent.setup();
      global.fetch
        .mockImplementationOnce(() => jsonResponse({ success: true, token: 'abc123' })) // login
        .mockImplementationOnce(() => jsonResponse({ valid: true })) // verify
        .mockImplementationOnce(() => jsonResponse(mockRegistrations)); // load registrations

      render(<AdminPage />);
      await screen.findByRole('heading', { name: /admin login/i });

      await user.type(screen.getByPlaceholderText(/enter your username/i), 'admin');
      await user.type(screen.getByPlaceholderText(/enter your password/i), 'secret');
      await user.click(screen.getByRole('button', { name: /sign in/i }));

      expect(await screen.findByText(/manage travel bookings/i)).toBeInTheDocument();
      expect(screen.getAllByText('Jane Doe').length).toBeGreaterThan(0);
      expect(localStorage.getItem('adminToken')).toBe('abc123');
      expect(global.fetch).toHaveBeenCalledTimes(3);
      expect(global.fetch).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('/api/admin/login'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ username: 'admin', password: 'secret' }),
        })
      );
    });

    test('shows the server-provided message on invalid credentials', async () => {
      const user = userEvent.setup();
      global.fetch.mockImplementationOnce(() =>
        jsonResponse({ success: false, message: 'Invalid credentials' }, false)
      );

      render(<AdminPage />);
      await screen.findByRole('heading', { name: /admin login/i });

      await user.type(screen.getByPlaceholderText(/enter your username/i), 'admin');
      await user.type(screen.getByPlaceholderText(/enter your password/i), 'wrong');
      await user.click(screen.getByRole('button', { name: /sign in/i }));

      expect(await screen.findByText('Invalid credentials')).toBeInTheDocument();
      expect(localStorage.getItem('adminToken')).toBeNull();
    });

    test('shows a generic error if the login request throws', async () => {
      const user = userEvent.setup();
      global.fetch.mockImplementationOnce(() => Promise.reject(new Error('network down')));

      render(<AdminPage />);
      await screen.findByRole('heading', { name: /admin login/i });

      await user.type(screen.getByPlaceholderText(/enter your username/i), 'admin');
      await user.type(screen.getByPlaceholderText(/enter your password/i), 'secret');
      await user.click(screen.getByRole('button', { name: /sign in/i }));

      expect(await screen.findByText(/server error\. please try again\./i)).toBeInTheDocument();
    });

    test('surfaces a "session invalid" error if post-login verification fails', async () => {
      const user = userEvent.setup();
      global.fetch
        .mockImplementationOnce(() => jsonResponse({ success: true, token: 'abc123' })) // login
        .mockImplementationOnce(() => jsonResponse({ valid: false })); // verify fails

      render(<AdminPage />);
      await screen.findByRole('heading', { name: /admin login/i });

      await user.type(screen.getByPlaceholderText(/enter your username/i), 'admin');
      await user.type(screen.getByPlaceholderText(/enter your password/i), 'secret');
      await user.click(screen.getByRole('button', { name: /sign in/i }));

      expect(await screen.findByText(/session invalid/i)).toBeInTheDocument();
      expect(localStorage.getItem('adminToken')).toBeNull();
    });
  });

  describe('with an existing session token', () => {
    test('verifies the token on mount and goes straight to the dashboard', async () => {
      localStorage.setItem('adminToken', 'stored-token');
      global.fetch
        .mockImplementationOnce(() => jsonResponse({ valid: true }))
        .mockImplementationOnce(() => jsonResponse(mockRegistrations));

      render(<AdminPage />);

      expect(await screen.findByText(/manage travel bookings/i)).toBeInTheDocument();
      expect(screen.getAllByText('Jane Doe').length).toBeGreaterThan(0);
      expect(screen.queryByRole('heading', { name: /admin login/i })).not.toBeInTheDocument();
      expect(global.fetch).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('/api/admin/verify'),
        expect.objectContaining({
          headers: { Authorization: 'Bearer stored-token' },
        })
      );
    });

    test('clears an invalid token and falls back to the login form', async () => {
      localStorage.setItem('adminToken', 'stale-token');
      global.fetch.mockImplementationOnce(() => jsonResponse({ valid: false }));

      render(<AdminPage />);

      expect(await screen.findByRole('heading', { name: /admin login/i })).toBeInTheDocument();
      expect(localStorage.getItem('adminToken')).toBeNull();
    });

    test('clears the token if the verify request throws', async () => {
      localStorage.setItem('adminToken', 'stale-token');
      global.fetch.mockImplementationOnce(() => Promise.reject(new Error('boom')));

      render(<AdminPage />);

      expect(await screen.findByRole('heading', { name: /admin login/i })).toBeInTheDocument();
      expect(localStorage.getItem('adminToken')).toBeNull();
    });
  });

  describe('the dashboard', () => {
    test('lists every registration returned by the API', async () => {
      await renderLoggedIn();

      expect(screen.getAllByText('Jane Doe').length).toBeGreaterThan(0);
      expect(screen.getAllByText('John Smith').length).toBeGreaterThan(0);
    });

    test('shows an empty state when there are no registrations', async () => {
      localStorage.setItem('adminToken', 'stored-token');
      global.fetch
        .mockImplementationOnce(() => jsonResponse({ valid: true }))
        .mockImplementationOnce(() => jsonResponse([]));

      render(<AdminPage />);

      expect(await screen.findByText(/no registrations yet/i)).toBeInTheDocument();
    });

    test('filters registrations as the search box is used', async () => {
      const user = userEvent.setup();
      await renderLoggedIn();

      await user.type(screen.getByPlaceholderText(/search customer, destination/i), 'tokyo');

      expect(screen.queryByText('Jane Doe')).not.toBeInTheDocument();
      expect(screen.getAllByText('John Smith').length).toBeGreaterThan(0);
    });

    test('expands a row to show details, then collapses it again', async () => {
      const user = userEvent.setup();
      await renderLoggedIn();

      expect(screen.queryByText('Honeymoon trip')).not.toBeInTheDocument();

      // "Jane Doe" appears once in the mobile card and once in the desktop
      // table; clicking either bubbles up to that row's toggle handler.
      const [firstJaneRow] = screen.getAllByText('Jane Doe');
      await user.click(firstJaneRow);

      const details = await screen.findAllByText('Honeymoon trip');
      expect(details.length).toBeGreaterThan(0);

      await user.click(firstJaneRow);
      await waitFor(() => {
        expect(screen.queryByText('Honeymoon trip')).not.toBeInTheDocument();
      });
    });

    test('sends a payment link for a row and refreshes the list', async () => {
      const user = userEvent.setup();
      await renderLoggedIn();

      const [firstJaneRow] = screen.getAllByText('Jane Doe');
      await user.click(firstJaneRow);

      global.fetch
        .mockImplementationOnce(() => jsonResponse({ success: true })) // send-payment-link
        .mockImplementationOnce(() => jsonResponse(mockRegistrations)); // reload

      const [sendButton] = await screen.findAllByRole('button', { name: /send link - pending/i });
      await user.click(sendButton);

      await waitFor(() => {
        expect(window.alert).toHaveBeenCalledWith('Payment link sent to jane@example.com!');
      });

      expect(global.fetch).toHaveBeenNthCalledWith(
        3,
        expect.stringContaining('/api/inquiry/1/send-payment-link'),
        expect.objectContaining({
          method: 'POST',
          headers: { Authorization: 'Bearer stored-token' },
        })
      );
      expect(global.fetch).toHaveBeenNthCalledWith(
        4,
        expect.stringContaining('/api/inquiry'),
        expect.objectContaining({ headers: { Authorization: 'Bearer stored-token' } })
      );
    });

    test('shows a failure alert if sending the payment link fails', async () => {
      const user = userEvent.setup();
      await renderLoggedIn();

      const [firstJaneRow] = screen.getAllByText('Jane Doe');
      await user.click(firstJaneRow);

      global.fetch.mockImplementationOnce(() => jsonResponse({ error: 'Provider error' }, false));

      const [sendButton] = await screen.findAllByRole('button', { name: /send link - pending/i });
      await user.click(sendButton);

      await waitFor(() => {
        expect(window.alert).toHaveBeenCalledWith('Failed to send payment link');
      });
    });

    test('disables the send-link button for an already-paid registration', async () => {
      const user = userEvent.setup();
      await renderLoggedIn();

      const [firstJohnRow] = screen.getAllByText('John Smith');
      await user.click(firstJohnRow);

      const resendButtons = await screen.findAllByRole('button', { name: /resend link/i });
      resendButtons.forEach((button) => expect(button).toBeDisabled());
    });

    test('toggles payment status for a row and refreshes the list', async () => {
      const user = userEvent.setup();
      const { container } = await renderLoggedIn();

      const [firstJaneRow] = screen.getAllByText('Jane Doe');
      await user.click(firstJaneRow);

      global.fetch
        .mockImplementationOnce(() => jsonResponse({ payment_status: 'paid' })) // patch
        .mockImplementationOnce(() => jsonResponse(mockRegistrations)); // reload

      // The paid/unpaid switch has no accessible text, so target it by its
      // distinguishing utility classes instead.
      const [toggle] = container.querySelectorAll('.h-6.w-11');
      await user.click(toggle);

      await waitFor(() => {
        expect(global.fetch).toHaveBeenNthCalledWith(
          3,
          expect.stringContaining('/api/inquiry/1/payment-status'),
          expect.objectContaining({
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              Authorization: 'Bearer stored-token',
            },
            body: JSON.stringify({ payment_status: 'paid' }),
          })
        );
      });
    });

    test('alerts on failure when toggling payment status', async () => {
      const user = userEvent.setup();
      const { container } = await renderLoggedIn();

      const [firstJaneRow] = screen.getAllByText('Jane Doe');
      await user.click(firstJaneRow);

      global.fetch.mockImplementationOnce(() => jsonResponse({ error: 'nope' }, false));

      const [toggle] = container.querySelectorAll('.h-6.w-11');
      await user.click(toggle);

      await waitFor(() => {
        expect(window.alert).toHaveBeenCalledWith('Failed to update payment status');
      });
    });

    test('switches to the CRM tab', async () => {
      const user = userEvent.setup();
      await renderLoggedIn();

      await user.click(screen.getByRole('button', { name: 'CRM' }));

      expect(screen.getByTestId('contacts-table')).toBeInTheDocument();
    });

    test('switches to the Campaigns tab', async () => {
      const user = userEvent.setup();
      await renderLoggedIn();

      await user.click(screen.getByRole('button', { name: 'Campaigns' }));

      expect(screen.getByTestId('campaigns-tab')).toBeInTheDocument();
    });

    test('logs out, clears the token, and redirects to /admin', async () => {
      const user = userEvent.setup();
      await renderLoggedIn();

      global.fetch.mockImplementationOnce(() => jsonResponse({ success: true }));

      const [logoutButton] = screen.getAllByRole('button', { name: /logout/i });
      await user.click(logoutButton);

      await waitFor(() => expect(localStorage.getItem('adminToken')).toBeNull());
      expect(window.location.href).toBe('/admin');
      expect(await screen.findByRole('heading', { name: /admin login/i })).toBeInTheDocument();
    });
  });
});