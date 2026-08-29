// Location: tests/unit/components/CampaignsTab.test.jsx
//
// The behaviour worth testing here is the wiring around sending email, since
// a mistake means real messages to real customers:
//   - what actually goes in the POST /send body (tag broadcast vs a manual
//     contactIds list), and that a manual send with nothing selected never
//     reaches the server
//   - the confirmation text, which is the last thing standing between a
//     click and an irreversible background send
//   - that opening the edit form re-fetches the full record, because the
//     list endpoint omits html_body (see the note in the component)
//   - the queued/sending poll, and that it stops when it should
//
// fetch is stubbed and routed by URL so tests don't depend on call order.
import React from 'react';
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/lib/api', () => ({ apiUrl: (path) => path }));

import CampaignsTab from '@/components/CampaignsTab';

const DRAFT = {
  id: 1,
  subject: 'Summer deals',
  status: 'draft',
  filter_tags: ['newsletter'],
  sent_count: 0,
  failed_count: 0,
  created_at: '2026-06-01T00:00:00.000Z',
};

const SENT = {
  id: 2,
  subject: 'Spring deals',
  status: 'sent',
  filter_tags: [],
  sent_count: 12,
  failed_count: 1,
  created_at: '2026-05-01T00:00:00.000Z',
};

// The detail endpoint returns html_body and recipients; the list does not.
const DRAFT_DETAIL = {
  ...DRAFT,
  html_body: '<p>Hi there</p>',
  recipients: [],
};

const CONTACTS = [
  { id: 10, first_name: 'Jane', last_name: 'Doe', email: 'jane@example.com', tags: ['vip'] },
  { id: 11, first_name: 'Bob', last_name: 'Smith', email: 'bob@example.com', tags: ['newsletter'] },
];

const json = (body, ok = true, status = 200) =>
  Promise.resolve({ ok, status, json: () => Promise.resolve(body) });

// Routes each request by URL + method. Overrides let a test change one
// endpoint without restating the rest.
function mockApi(overrides = {}) {
  const {
    list = [DRAFT, SENT],
    detail = DRAFT_DETAIL,
    contacts = CONTACTS,
    listResponse,
    detailResponse,
    contactsResponse,
    sendResponse,
    saveResponse,
    deleteResponse,
    previewResponse,
  } = overrides;

  global.fetch = vi.fn((url, options = {}) => {
    const method = options.method || 'GET';
    const u = String(url);

    if (u.includes('/available-contacts')) return contactsResponse ?? json(contacts);
    if (u.includes('/preview-recipients')) return previewResponse ?? json({ count: 42 });
    if (u.endsWith('/send') && method === 'POST') return sendResponse ?? json({ ok: true, queuedCount: 3 });
    if (u === '/api/campaigns' && method === 'GET') return listResponse ?? json(list);
    if (u === '/api/campaigns' && method === 'POST') return saveResponse ?? json({ id: 99 });
    if (method === 'PATCH') return saveResponse ?? json({ id: 1 });
    if (method === 'DELETE') return deleteResponse ?? json({ ok: true });
    if (method === 'GET') return detailResponse ?? json(detail);
    return json({});
  });
  return global.fetch;
}

const callsTo = (matcher, method) =>
  global.fetch.mock.calls.filter(([url, opts = {}]) => {
    const okUrl = typeof matcher === 'string' ? String(url).includes(matcher) : matcher(String(url));
    return okUrl && (!method || (opts.method || 'GET') === method);
  });

const openDetailFor = async (user, subject = 'Summer deals') => {
  await user.click(screen.getByRole('button', { name: subject }));
  return screen.findByRole('heading', { name: subject });
};

beforeEach(() => {
  localStorage.setItem('adminToken', 'test-token');
  vi.stubGlobal('confirm', vi.fn(() => true));
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('CampaignsTab — list', () => {
  test('loads campaigns on mount with the admin token', async () => {
    mockApi();
    render(<CampaignsTab />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/campaigns',
        expect.objectContaining({ headers: { Authorization: 'Bearer test-token' } })
      );
    });
  });

  test('shows a loading state, then the rows', async () => {
    let resolve;
    global.fetch = vi.fn(() => new Promise((r) => { resolve = r; }));

    render(<CampaignsTab />);
    expect(screen.getByText('Loading campaigns…')).toBeInTheDocument();

    resolve({ ok: true, status: 200, json: () => Promise.resolve([DRAFT]) });
    expect(await screen.findByRole('button', { name: 'Summer deals' })).toBeInTheDocument();
  });

  test('shows an empty state when there are no campaigns', async () => {
    mockApi({ list: [] });
    render(<CampaignsTab />);

    expect(await screen.findByText('No campaigns yet.')).toBeInTheDocument();
  });

  test('shows an error when the list request fails', async () => {
    mockApi({ listResponse: json({}, false, 500) });
    render(<CampaignsTab />);

    expect(await screen.findByText('Failed to load campaigns.')).toBeInTheDocument();
  });

  test('renders tags, falling back to "All contacts" when there are none', async () => {
    mockApi();
    render(<CampaignsTab />);
    await screen.findByRole('button', { name: 'Summer deals' });

    expect(screen.getByText('newsletter')).toBeInTheDocument();
    expect(screen.getByText('All contacts')).toBeInTheDocument();
  });

  test('offers Edit and Delete only for drafts', async () => {
    mockApi();
    render(<CampaignsTab />);
    await screen.findByRole('button', { name: 'Summer deals' });

    // Two campaigns render, but only the draft is editable/deletable —
    // the server rejects editing a sent campaign, so the UI mustn't offer it.
    expect(screen.getAllByRole('button', { name: 'Edit' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Delete' })).toHaveLength(1);
  });
});

describe('CampaignsTab — draft form', () => {
  test('creates a new campaign with parsed tags', async () => {
    const user = userEvent.setup();
    mockApi();
    render(<CampaignsTab />);
    await screen.findByRole('button', { name: 'Summer deals' });

    await user.click(screen.getByRole('button', { name: 'New Campaign' }));
    await user.type(screen.getByPlaceholderText(/exclusive summer travel deals/i), 'Autumn deals');
    await user.type(screen.getByPlaceholderText(/newsletter, bahamas-interest/i), ' vip , newsletter , , ');
    await user.type(screen.getByPlaceholderText('<p>Hi there...</p>'), '<p>Body</p>');
    await user.click(screen.getByRole('button', { name: 'Save Draft' }));

    await waitFor(() => {
      const [, opts] = callsTo('/api/campaigns', 'POST')[0];
      expect(JSON.parse(opts.body)).toEqual({
        subject: 'Autumn deals',
        htmlBody: '<p>Body</p>',
        filterTags: ['vip', 'newsletter'],
      });
    });
  });

  test('re-fetches the full record when editing, since the list omits html_body', async () => {
    const user = userEvent.setup();
    mockApi();
    render(<CampaignsTab />);
    await screen.findByRole('button', { name: 'Summer deals' });

    await user.click(screen.getByRole('button', { name: 'Edit' }));

    // Without this fetch the HTML body would open blank and silently
    // overwrite the real content on save.
    await waitFor(() => {
      expect(screen.getByPlaceholderText('<p>Hi there...</p>')).toHaveValue('<p>Hi there</p>');
    });
    expect(screen.getByPlaceholderText(/exclusive summer travel deals/i)).toHaveValue('Summer deals');
    expect(screen.getByPlaceholderText(/newsletter, bahamas-interest/i)).toHaveValue('newsletter');
  });

  test('saves an edit with PATCH to the campaign id', async () => {
    const user = userEvent.setup();
    mockApi();
    render(<CampaignsTab />);
    await screen.findByRole('button', { name: 'Summer deals' });

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await waitFor(() => {
      expect(screen.getByPlaceholderText('<p>Hi there...</p>')).toHaveValue('<p>Hi there</p>');
    });
    await user.click(screen.getByRole('button', { name: 'Save Draft' }));

    await waitFor(() => {
      const patches = callsTo('/api/campaigns/1', 'PATCH');
      expect(patches).toHaveLength(1);
    });
    expect(callsTo('/api/campaigns', 'POST')).toHaveLength(0);
  });

  test('shows an error if the edit fetch fails', async () => {
    const user = userEvent.setup();
    mockApi({ detailResponse: json({}, false, 500) });
    render(<CampaignsTab />);
    await screen.findByRole('button', { name: 'Summer deals' });

    await user.click(screen.getByRole('button', { name: 'Edit' }));

    expect(await screen.findByText('Failed to load campaign content.')).toBeInTheDocument();
  });

  test('surfaces a server-side save error', async () => {
    const user = userEvent.setup();
    mockApi({ saveResponse: json({ error: 'Subject and HTML body are required.' }, false, 400) });
    render(<CampaignsTab />);
    await screen.findByRole('button', { name: 'Summer deals' });

    await user.click(screen.getByRole('button', { name: 'New Campaign' }));
    await user.type(screen.getByPlaceholderText(/exclusive summer travel deals/i), 'x');
    await user.type(screen.getByPlaceholderText('<p>Hi there...</p>'), 'y');
    await user.click(screen.getByRole('button', { name: 'Save Draft' }));

    expect(await screen.findByText('Subject and HTML body are required.')).toBeInTheDocument();
  });

  test('Cancel closes the form without saving', async () => {
    const user = userEvent.setup();
    mockApi();
    render(<CampaignsTab />);
    await screen.findByRole('button', { name: 'Summer deals' });

    await user.click(screen.getByRole('button', { name: 'New Campaign' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('heading', { name: 'New Campaign' })).not.toBeInTheDocument();
    expect(callsTo('/api/campaigns', 'POST')).toHaveLength(0);
  });
});

describe('CampaignsTab — delete', () => {
  test('deletes after confirmation and reloads the list', async () => {
    const user = userEvent.setup();
    mockApi();
    render(<CampaignsTab />);
    await screen.findByRole('button', { name: 'Summer deals' });
    const listCallsBefore = callsTo('/api/campaigns', 'GET').length;

    await user.click(screen.getByRole('button', { name: 'Delete' }));

    expect(confirm).toHaveBeenCalled();
    await waitFor(() => expect(callsTo('/api/campaigns/1', 'DELETE')).toHaveLength(1));
    await waitFor(() => {
      expect(callsTo('/api/campaigns', 'GET').length).toBeGreaterThan(listCallsBefore);
    });
  });

  test('does nothing when the confirmation is dismissed', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('confirm', vi.fn(() => false));
    mockApi();
    render(<CampaignsTab />);
    await screen.findByRole('button', { name: 'Summer deals' });

    await user.click(screen.getByRole('button', { name: 'Delete' }));

    expect(callsTo('/api/campaigns/1', 'DELETE')).toHaveLength(0);
  });

  test('surfaces a server-side delete error', async () => {
    const user = userEvent.setup();
    mockApi({ deleteResponse: json({ error: 'Only draft campaigns can be deleted.' }, false, 400) });
    render(<CampaignsTab />);
    await screen.findByRole('button', { name: 'Summer deals' });

    await user.click(screen.getByRole('button', { name: 'Delete' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Only draft campaigns can be deleted.');
  });
});

describe('CampaignsTab — detail panel', () => {
  test('opens the detail panel for a campaign', async () => {
    const user = userEvent.setup();
    mockApi();
    render(<CampaignsTab />);
    await screen.findByRole('button', { name: 'Summer deals' });

    await openDetailFor(user);

    expect(screen.getByRole('heading', { name: 'Summer deals' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send Now' })).toBeInTheDocument();
  });

  test('previews the audience size', async () => {
    const user = userEvent.setup();
    mockApi();
    render(<CampaignsTab />);
    await screen.findByRole('button', { name: 'Summer deals' });
    await openDetailFor(user);

    await user.click(screen.getByRole('button', { name: /preview audience size/i }));

    expect(await screen.findByText('42 contact(s) match')).toBeInTheDocument();
  });

  test('hides the send controls for a campaign that is already sent', async () => {
    const user = userEvent.setup();
    mockApi({ detail: { ...SENT, html_body: '<p>x</p>', recipients: [] } });
    render(<CampaignsTab />);
    await screen.findByRole('button', { name: 'Spring deals' });

    await openDetailFor(user, 'Spring deals');

    expect(screen.queryByRole('button', { name: 'Send Now' })).not.toBeInTheDocument();
    expect(screen.queryByText('Recipients')).not.toBeInTheDocument();
  });

  test('lists recipients with their statuses and errors', async () => {
    const user = userEvent.setup();
    mockApi({
      detail: {
        ...SENT,
        recipients: [
          { id: 1, first_name: 'Jane', last_name: 'Doe', email: 'jane@example.com', status: 'sent' },
          { id: 2, first_name: 'Bob', last_name: 'Smith', email: 'bob@example.com', status: 'failed', error: 'Mailbox full' },
        ],
      },
    });
    render(<CampaignsTab />);
    await screen.findByRole('button', { name: 'Spring deals' });
    await openDetailFor(user, 'Spring deals');

    expect(screen.getByRole('heading', { name: /recipients \(2\)/i })).toBeInTheDocument();
    expect(screen.getByText('Mailbox full')).toBeInTheDocument();
  });
});

describe('CampaignsTab — manual recipient selection', () => {
  const openManual = async (user) => {
    await openDetailFor(user);
    await user.click(screen.getByRole('radio', { name: /select specific contacts/i }));
    await screen.findByText('jane@example.com');
  };

  test('loads contacts when switching to manual mode', async () => {
    const user = userEvent.setup();
    mockApi();
    render(<CampaignsTab />);
    await screen.findByRole('button', { name: 'Summer deals' });

    await openManual(user);

    expect(callsTo('/available-contacts')).toHaveLength(1);
    expect(screen.getByText('bob@example.com')).toBeInTheDocument();
  });

  test('filters the contact list by the search box', async () => {
    const user = userEvent.setup();
    mockApi();
    render(<CampaignsTab />);
    await screen.findByRole('button', { name: 'Summer deals' });
    await openManual(user);

    await user.type(screen.getByPlaceholderText(/search name, email, or tag/i), 'bob');

    expect(screen.queryByText('jane@example.com')).not.toBeInTheDocument();
    expect(screen.getByText('bob@example.com')).toBeInTheDocument();
  });

  test('selects all filtered contacts, and clears the selection', async () => {
    const user = userEvent.setup();
    mockApi();
    render(<CampaignsTab />);
    await screen.findByRole('button', { name: 'Summer deals' });
    await openManual(user);

    await user.click(screen.getByRole('button', { name: /select all \(2\)/i }));
    expect(screen.getByText('2 selected')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /clear selection/i }));
    expect(screen.getByText('0 selected')).toBeInTheDocument();
  });

  test('"select all" only takes the contacts matching the current search', async () => {
    const user = userEvent.setup();
    mockApi();
    render(<CampaignsTab />);
    await screen.findByRole('button', { name: 'Summer deals' });
    await openManual(user);

    await user.type(screen.getByPlaceholderText(/search name, email, or tag/i), 'bob');
    await user.click(screen.getByRole('button', { name: /select all matching \(1\)/i }));

    expect(screen.getByText('1 selected')).toBeInTheDocument();
  });

  test('disables the send button while nothing is selected', async () => {
    const user = userEvent.setup();
    mockApi();
    render(<CampaignsTab />);
    await screen.findByRole('button', { name: 'Summer deals' });
    await openManual(user);

    // Guards against queueing a manual send with an empty recipient list.
    expect(screen.getByRole('button', { name: /send to 0 selected/i })).toBeDisabled();
  });
});

describe('CampaignsTab — sending', () => {
  test('a tag-based send posts an empty body', async () => {
    const user = userEvent.setup();
    mockApi();
    render(<CampaignsTab />);
    await screen.findByRole('button', { name: 'Summer deals' });
    await openDetailFor(user);

    await user.click(screen.getByRole('button', { name: 'Send Now' }));

    await waitFor(() => expect(callsTo('/api/campaigns/1/send', 'POST')).toHaveLength(1));
    const [, opts] = callsTo('/api/campaigns/1/send', 'POST')[0];
    // An empty body tells the server to use the campaign's filter_tags.
    expect(JSON.parse(opts.body)).toEqual({});
  });

  test('a manual send posts the selected contact ids', async () => {
    const user = userEvent.setup();
    mockApi();
    render(<CampaignsTab />);
    await screen.findByRole('button', { name: 'Summer deals' });
    await openDetailFor(user);
    await user.click(screen.getByRole('radio', { name: /select specific contacts/i }));
    await screen.findByText('jane@example.com');

    await user.click(screen.getAllByRole('checkbox')[0]);
    await user.click(screen.getByRole('button', { name: /send to 1 selected/i }));

    await waitFor(() => expect(callsTo('/api/campaigns/1/send', 'POST')).toHaveLength(1));
    const [, opts] = callsTo('/api/campaigns/1/send', 'POST')[0];
    expect(JSON.parse(opts.body)).toEqual({ contactIds: [10] });
  });

  test('the confirmation names the campaign and the audience size', async () => {
    const user = userEvent.setup();
    mockApi();
    render(<CampaignsTab />);
    await screen.findByRole('button', { name: 'Summer deals' });
    await openDetailFor(user);

    await user.click(screen.getByRole('button', { name: /preview audience size/i }));
    await screen.findByText('42 contact(s) match');
    await user.click(screen.getByRole('button', { name: 'Send Now' }));

    // This dialog is the last thing between a click and an irreversible send.
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('42 contact(s)'));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Summer deals'));
  });

  test('dismissing the confirmation sends nothing', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('confirm', vi.fn(() => false));
    mockApi();
    render(<CampaignsTab />);
    await screen.findByRole('button', { name: 'Summer deals' });
    await openDetailFor(user);

    await user.click(screen.getByRole('button', { name: 'Send Now' }));

    expect(callsTo('/api/campaigns/1/send', 'POST')).toHaveLength(0);
  });

  test('surfaces a server-side send error', async () => {
    const user = userEvent.setup();
    mockApi({ sendResponse: json({ error: 'This campaign has already been sent.' }, false, 400) });
    render(<CampaignsTab />);
    await screen.findByRole('button', { name: 'Summer deals' });
    await openDetailFor(user);

    await user.click(screen.getByRole('button', { name: 'Send Now' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('This campaign has already been sent.');
  });
});

describe('CampaignsTab — progress polling', () => {
  test('polls while a campaign is queued, and stops once it is sent', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    const queued = { ...DRAFT, status: 'queued', recipients: [] };
    const sent = { ...DRAFT, status: 'sent', recipients: [] };
    let detailPayload = queued;

    mockApi({ list: [{ ...DRAFT, status: 'queued' }] });
    const baseFetch = global.fetch;
    global.fetch = vi.fn((url, options = {}) => {
      if (String(url) === '/api/campaigns/1' && (options.method || 'GET') === 'GET') {
        return json(detailPayload);
      }
      return baseFetch(url, options);
    });

    render(<CampaignsTab />);
    await screen.findByRole('button', { name: 'Summer deals' });
    await user.click(screen.getByRole('button', { name: 'Summer deals' }));
    await screen.findByText(/queued — sending will begin shortly/i);

    const before = callsTo('/api/campaigns/1', 'GET').length;
    await act(async () => { await vi.advanceTimersByTimeAsync(4100); });
    expect(callsTo('/api/campaigns/1', 'GET').length).toBeGreaterThan(before);

    // Once the server reports 'sent', the effect's dependency changes and the
    // interval is torn down — otherwise it would poll forever.
    detailPayload = sent;
    await act(async () => { await vi.advanceTimersByTimeAsync(4100); });
    const afterSent = callsTo('/api/campaigns/1', 'GET').length;
    await act(async () => { await vi.advanceTimersByTimeAsync(12000); });
    expect(callsTo('/api/campaigns/1', 'GET').length).toBe(afterSent);

    vi.useRealTimers();
  });

  test('does not poll for a draft campaign', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mockApi();

    render(<CampaignsTab />);
    await screen.findByRole('button', { name: 'Summer deals' });
    await user.click(screen.getByRole('button', { name: 'Summer deals' }));
    await screen.findByRole('heading', { name: 'Summer deals' });

    const before = callsTo('/api/campaigns/1', 'GET').length;
    await act(async () => { await vi.advanceTimersByTimeAsync(12000); });
    expect(callsTo('/api/campaigns/1', 'GET').length).toBe(before);

    vi.useRealTimers();
  });
});