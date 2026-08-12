// src/api/crmApi.js
import { apiUrl } from '@/lib/api';

async function request(path, options = {}) {
  const token = localStorage.getItem('adminToken');
  const isFormData = options.body instanceof FormData;

  const res = await fetch(apiUrl(`/api${path}`), {
    ...options,
    headers: {
      ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

export const contactsApi = {
  list: (params = {}) => request(`/contacts?${new URLSearchParams(params)}`),
  get: (id) => request(`/contacts/${id}`),
  create: (data) => request('/contacts', { method: 'POST', body: JSON.stringify(data) }),
  update: (id, data) => request(`/contacts/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  remove: (id) => request(`/contacts/${id}`, { method: 'DELETE' }),
  import: (file) => {
    const formData = new FormData();
    formData.append('file', file);
    return request('/contacts/import', { method: 'POST', body: formData });
  },
  // Step-up gated: requires the admin's current password to decrypt and
  // return date of birth and detailed dietary/medical data for one
  // contact. Passport data is not stored anywhere in this app.
  revealSensitive: (id, reauthPassword) =>
    request(`/contacts/${id}/reveal-sensitive`, {
      method: 'POST',
      body: JSON.stringify({ reauthPassword }),
    }),
};