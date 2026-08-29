// Location: tests/unit/components/AdminGiveawayEntries.test.jsx
import React from 'react';
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AdminGiveawayEntries from '@/components/AdminGiveawayEntries';

vi.mock('@/lib/api', () => ({
  apiUrl: (path) => path,
}));

const SETTINGS = {
  startDate: '2026-06-01T00:00:00.000Z',
  endDate: '2026-06-30T23:59:59.000Z',
  prizeValueUsd: 1000,
  prizeValueCad: 1350,
  destinations: ['Bahamas', 'Jamaica'],
};

const ENTRIES = [
  {
    id: 1,
    name: 'Inside Window',
    email: 'inside@example.com',
    destination: 'Bahamas',
    created_at: '2026-06-15T12:00:00.000Z',
    is_winner: false,
    winner_email_sent: false,
  },
  {
    id: 2,
    name: 'Too Early',
    email: 'early@example.com',
    destination: 'Jamaica',
    created_at: '2026-05-01T12:00:00.000Z',
    is_winner: false,
    winner_email_sent: false,
  },
];

const json = (body, ok = true, status = 200) =>
  Promise.resolve({ ok, status, json: () => Promise.resolve(body) });

// Routes each fetch by URL so tests don't depend on call ordering.
function mockApi({ entries = ENTRIES, settings = SETTINGS, pickResponse } = {}) {
  global.fetch = vi.fn((url, options = {}) => {
    if (url.includes('/api/giveaway/settings')) return json(settings);
    if (url.includes('/api/giveaway/pick-winner')) {
      return pickResponse ?? json({ ok: true, winner: entries[0], eligibleCount: 1 });
    }
    if (url === '/api/giveaway' && (!options.method || options.method === 'GET')) {
      return json(entries);
    }
    return json({ ok: true });
  });
}

beforeEach(() => {
  localStorage.setItem('adminToken', 'test-token');
  window.alert = vi.fn();
  window.confirm = vi.fn(() => true);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('AdminGiveawayEntries — winner selection', () => {
  test('does not pick a winner on its own', async () => {
    mockApi();
    render(<AdminGiveawayEntries />);
    await screen.findAllByText('Inside Window');

    // Mounting must never call the picker — selection is always explicit.
    const pickCalls = global.fetch.mock.calls.filter(([url]) =>
      String(url).includes('pick-winner')
    );
    expect(pickCalls).toHaveLength(0);
  });

  test('marks entries outside the giveaway window', async () => {
    mockApi();
    render(<AdminGiveawayEntries />);
    await screen.findAllByText('Too Early');

    await waitFor(() => {
      expect(screen.getAllByText('Outside window').length).toBeGreaterThan(0);
    });
    expect(screen.getByText(/1 of 2 entries are inside the giveaway window/i)).toBeInTheDocument();
    expect(screen.getByText(/1 excluded from random selection/i)).toBeInTheDocument();
  });

  test('asks for confirmation and calls pick-winner with the admin token', async () => {
    const user = userEvent.setup();
    mockApi();
    render(<AdminGiveawayEntries />);
    await screen.findAllByText('Inside Window');

    await user.click(screen.getByRole('button', { name: /pick random winner/i }));

    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/giveaway/pick-winner',
        expect.objectContaining({
          method: 'POST',
          headers: { Authorization: 'Bearer test-token' },
        })
      );
    });
  });

  test('does not call the server when the confirmation is cancelled', async () => {
    const user = userEvent.setup();
    window.confirm = vi.fn(() => false);
    mockApi();
    render(<AdminGiveawayEntries />);
    await screen.findAllByText('Inside Window');

    await user.click(screen.getByRole('button', { name: /pick random winner/i }));

    const pickCalls = global.fetch.mock.calls.filter(([url]) =>
      String(url).includes('pick-winner')
    );
    expect(pickCalls).toHaveLength(0);
  });

  test('disables the button when no entry falls inside the window', async () => {
    mockApi({ entries: [ENTRIES[1]] }); // only the out-of-window entry
    render(<AdminGiveawayEntries />);
    await screen.findAllByText('Too Early');

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /pick random winner/i })).toBeDisabled();
    });
  });

  test('surfaces a server-side refusal instead of failing silently', async () => {
    const user = userEvent.setup();
    mockApi({
      pickResponse: json(
        { error: 'No entries were submitted within the giveaway window, so there is nobody to pick from.' },
        false,
        400
      ),
    });
    render(<AdminGiveawayEntries />);
    await screen.findAllByText('Inside Window');

    await user.click(screen.getByRole('button', { name: /pick random winner/i }));

    expect(await screen.findByText(/nobody to pick from/i)).toBeInTheDocument();
  });
});