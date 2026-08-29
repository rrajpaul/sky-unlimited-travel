// Location: tests/unit/api/crmApi.test.js
//
// crmApi is a thin wrapper, but the parts worth testing are the ones that
// fail quietly when they break:
//   - FormData uploads must NOT get a Content-Type header, or the browser
//     can't add the multipart boundary and the upload fails server-side
//   - the Authorization header is only attached when a token exists
//   - error bodies that aren't JSON must still produce a useful Error
//   - 204 returns null rather than blowing up on an empty body
//
// fetch is stubbed; nothing here touches the network.
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/api', () => ({
  apiUrl: (path) => `http://test.local${path}`,
}));

import { contactsApi } from '@/api/crmApi';

// Builds a fetch stub resolving to a Response-like object.
function mockFetch({ ok = true, status = 200, body = {}, jsonThrows = false } = {}) {
  const json = jsonThrows
    ? vi.fn().mockRejectedValue(new SyntaxError('Unexpected token < in JSON'))
    : vi.fn().mockResolvedValue(body);
  global.fetch = vi.fn().mockResolvedValue({ ok, status, json });
  return global.fetch;
}

// Convenience accessors for the single fetch call a request makes.
const calledUrl = () => global.fetch.mock.calls[0][0];
const calledOpts = () => global.fetch.mock.calls[0][1];

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('crmApi — URL construction', () => {
  test('prefixes /api and routes through apiUrl', async () => {
    mockFetch({ body: [] });
    await contactsApi.get(42);

    expect(calledUrl()).toBe('http://test.local/api/contacts/42');
  });

  test('serialises list params into a query string', async () => {
    mockFetch({ body: [] });
    await contactsApi.list({ search: 'jane doe', tag: 'vip' });

    expect(calledUrl()).toBe('http://test.local/api/contacts?search=jane+doe&tag=vip');
  });

  test('list with no params still produces a valid URL', async () => {
    mockFetch({ body: [] });
    await contactsApi.list();

    expect(calledUrl()).toBe('http://test.local/api/contacts?');
  });
});

describe('crmApi — auth header', () => {
  test('attaches the bearer token when one is stored', async () => {
    localStorage.setItem('adminToken', 'tok-123');
    mockFetch({ body: {} });

    await contactsApi.get(1);

    expect(calledOpts().headers.Authorization).toBe('Bearer tok-123');
  });

  test('omits the Authorization header entirely when there is no token', async () => {
    mockFetch({ body: {} });

    await contactsApi.get(1);

    // Absent, not "Bearer null" — the latter would look like a malformed
    // credential to the server rather than an anonymous request.
    expect(calledOpts().headers).not.toHaveProperty('Authorization');
  });

  test('reads the token fresh on every call', async () => {
    mockFetch({ body: {} });
    await contactsApi.get(1);
    expect(calledOpts().headers).not.toHaveProperty('Authorization');

    localStorage.setItem('adminToken', 'later-token');
    await contactsApi.get(2);
    expect(global.fetch.mock.calls[1][1].headers.Authorization).toBe('Bearer later-token');
  });
});

describe('crmApi — JSON requests', () => {
  test('sets Content-Type and serialises the body on create', async () => {
    mockFetch({ body: { id: 9 } });

    await contactsApi.create({ first_name: 'Jane' });

    const opts = calledOpts();
    expect(opts.method).toBe('POST');
    expect(opts.headers['Content-Type']).toBe('application/json');
    expect(opts.body).toBe(JSON.stringify({ first_name: 'Jane' }));
  });

  test('update sends PUT to the id-scoped path', async () => {
    mockFetch({ body: { id: 9 } });

    await contactsApi.update(9, { city: 'Toronto' });

    expect(calledUrl()).toBe('http://test.local/api/contacts/9');
    expect(calledOpts().method).toBe('PUT');
    expect(calledOpts().body).toBe(JSON.stringify({ city: 'Toronto' }));
  });

  test('remove sends DELETE', async () => {
    mockFetch({ status: 204 });

    await contactsApi.remove(9);

    expect(calledUrl()).toBe('http://test.local/api/contacts/9');
    expect(calledOpts().method).toBe('DELETE');
  });

  test('returns the parsed JSON body', async () => {
    mockFetch({ body: [{ id: 1, first_name: 'Jane' }] });

    const result = await contactsApi.list();

    expect(result).toEqual([{ id: 1, first_name: 'Jane' }]);
  });
});

describe('crmApi — file upload', () => {
  test('does NOT set Content-Type for FormData', async () => {
    mockFetch({ body: { created: 3 } });
    const file = new File(['col1,col2'], 'contacts.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    await contactsApi.import(file);

    // Setting it manually would omit the multipart boundary the browser
    // generates, and the server would fail to parse the upload.
    expect(calledOpts().headers).not.toHaveProperty('Content-Type');
  });

  test('sends the file as FormData under the "file" field', async () => {
    mockFetch({ body: { created: 3 } });
    const file = new File(['data'], 'contacts.xlsx');

    await contactsApi.import(file);

    const body = calledOpts().body;
    expect(body).toBeInstanceOf(FormData);
    expect(body.get('file')).toBe(file);
    expect(calledUrl()).toBe('http://test.local/api/contacts/import');
    expect(calledOpts().method).toBe('POST');
  });

  test('still attaches the auth token on an upload', async () => {
    localStorage.setItem('adminToken', 'tok-123');
    mockFetch({ body: {} });

    await contactsApi.import(new File(['x'], 'c.xlsx'));

    expect(calledOpts().headers.Authorization).toBe('Bearer tok-123');
  });
});

describe('crmApi — error handling', () => {
  test('throws the server-provided error message', async () => {
    mockFetch({ ok: false, status: 400, body: { error: 'Email already in use' } });

    await expect(contactsApi.create({})).rejects.toThrow('Email already in use');
  });

  test('falls back to the status code when the error body has no error field', async () => {
    mockFetch({ ok: false, status: 500, body: {} });

    await expect(contactsApi.get(1)).rejects.toThrow('Request failed: 500');
  });

  test('falls back to the status code when the error body is not JSON at all', async () => {
    // e.g. an HTML error page from a proxy — res.json() rejects, and the
    // helper must not let that mask the real failure.
    mockFetch({ ok: false, status: 502, jsonThrows: true });

    await expect(contactsApi.get(1)).rejects.toThrow('Request failed: 502');
  });

  test('surfaces a 401 so callers can handle an expired session', async () => {
    mockFetch({ ok: false, status: 401, body: { error: 'Unauthorized' } });

    await expect(contactsApi.list()).rejects.toThrow('Unauthorized');
  });

  test('propagates a network-level failure', async () => {
    global.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(contactsApi.get(1)).rejects.toThrow('Failed to fetch');
  });
});

describe('crmApi — 204 handling', () => {
  test('returns null instead of parsing an empty body', async () => {
    const json = vi.fn().mockRejectedValue(new Error('should not be called'));
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 204, json });

    const result = await contactsApi.remove(9);

    expect(result).toBeNull();
    expect(json).not.toHaveBeenCalled();
  });
});

describe('crmApi — revealSensitive', () => {
  test('posts the reauth password to the id-scoped step-up route', async () => {
    localStorage.setItem('adminToken', 'tok-123');
    mockFetch({ body: { dob: '1990-04-12', dietarySpecialNeeds: {} } });

    await contactsApi.revealSensitive(7, 'hunter2');

    expect(calledUrl()).toBe('http://test.local/api/contacts/7/reveal-sensitive');
    expect(calledOpts().method).toBe('POST');
    expect(calledOpts().body).toBe(JSON.stringify({ reauthPassword: 'hunter2' }));
    expect(calledOpts().headers.Authorization).toBe('Bearer tok-123');
  });

  test('returns the decrypted payload', async () => {
    const payload = {
      dob: '1990-04-12',
      dietarySpecialNeeds: { foodAllergies: ['Peanut'], otherNotes: 'Aisle seat' },
    };
    mockFetch({ body: payload });

    await expect(contactsApi.revealSensitive(7, 'hunter2')).resolves.toEqual(payload);
  });

  test('throws the server message on a wrong password', async () => {
    mockFetch({ ok: false, status: 403, body: { error: 'Incorrect password' } });

    // ContactForm renders this message directly, so the text matters.
    await expect(contactsApi.revealSensitive(7, 'nope')).rejects.toThrow('Incorrect password');
  });
});