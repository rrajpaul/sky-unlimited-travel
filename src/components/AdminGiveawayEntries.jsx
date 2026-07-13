import React, { useEffect, useState } from 'react';
import { apiUrl } from '@/lib/api';

/**
 * AdminGiveawayEntries
 *
 * Displays giveaway entries for admins, matching the pattern used in Admin.jsx
 * (apiUrl() helper for requests, "adminToken" in localStorage for auth).
 * Drop this in as a route in your admin area, e.g.:
 *
 *   import AdminGiveawayEntries from '@/components/AdminGiveawayEntries';
 *   ...
 *   <Route path="/admin/giveaway" element={<AdminGiveawayEntries />} />
 *
 * NOTE: unlike Admin.jsx, this component does not include its own login form.
 * It assumes you reach it after already logging in via /admin (same
 * localStorage token is reused). If a valid token isn't present, it will
 * show a "Failed to load entries" error rather than a login screen.
 */

function getToken() {
  return localStorage.getItem('adminToken');
}

function toDatetimeLocalValue(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const AdminGiveawayEntries = () => {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionId, setActionId] = useState(null);

  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [prizeValueUsd, setPrizeValueUsd] = useState('');
  const [prizeValueCad, setPrizeValueCad] = useState('');
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsError, setSettingsError] = useState('');
  const [settingsSaved, setSettingsSaved] = useState(false);

  const loadSettings = async () => {
    setSettingsLoading(true);
    setSettingsError('');
    try {
      const res = await fetch(apiUrl('/api/giveaway/settings'));
      if (!res.ok) throw new Error('Failed to load giveaway dates');
      const data = await res.json();
      setStartDate(toDatetimeLocalValue(data.startDate));
      setEndDate(toDatetimeLocalValue(data.endDate));
      setPrizeValueUsd(String(data.prizeValueUsd ?? ''));
      setPrizeValueCad(String(data.prizeValueCad ?? ''));
    } catch (err) {
      setSettingsError(err.message || 'Failed to load giveaway dates');
    } finally {
      setSettingsLoading(false);
    }
  };

  const saveSettings = async (e) => {
    e.preventDefault();
    setSettingsSaving(true);
    setSettingsError('');
    setSettingsSaved(false);
    try {
      const res = await fetch(apiUrl('/api/giveaway/settings'), {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getToken()}`,
        },
        body: JSON.stringify({
          startDate: new Date(startDate).toISOString(),
          endDate: new Date(endDate).toISOString(),
          prizeValueUsd: parseFloat(prizeValueUsd),
          prizeValueCad: parseFloat(prizeValueCad),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to save dates');
      setSettingsSaved(true);
      setTimeout(() => setSettingsSaved(false), 3000);
    } catch (err) {
      setSettingsError(err.message || 'Failed to save dates');
    } finally {
      setSettingsSaving(false);
    }
  };

  const loadEntries = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(apiUrl('/api/giveaway'), {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (!res.ok) throw new Error('Failed to load entries');
      const data = await res.json();
      setEntries(data);
    } catch (err) {
      setError(err.message || 'Failed to load entries');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadEntries();
    loadSettings();
  }, []);

  const markWinner = async (id) => {
    setActionId(id);
    try {
      const res = await fetch(apiUrl(`/api/giveaway/${id}/mark-winner`), {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (!res.ok) throw new Error('Failed to mark winner');
      await loadEntries();
    } catch (err) {
      setError(err.message || 'Failed to mark winner');
    } finally {
      setActionId(null);
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-6 py-10">
      <div className="flex items-center justify-between mb-2">
        <a
          href="/admin"
          className="text-sm font-medium text-indigo-600 hover:text-indigo-800 transition-colors duration-150"
        >
          ← Back to Registrations
        </a>
      </div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-[#1a2947]">
          Giveaway Entries
        </h1>
        <span className="text-sm text-slate-500">
          {entries.length} {entries.length === 1 ? 'entry' : 'entries'}
        </span>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3 mb-4">
          {error}
        </div>
      )}

      <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 mb-8">
        <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-4">
          Giveaway Window
        </h2>
        {settingsLoading ? (
          <p className="text-slate-500 text-sm">Loading dates…</p>
        ) : (
          <form onSubmit={saveSettings} className="flex flex-wrap items-end gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Start date
              </label>
              <input
                type="datetime-local"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                required
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#1a2947]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                End date
              </label>
              <input
                type="datetime-local"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                required
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#1a2947]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Prize (USD)
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">$</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={prizeValueUsd}
                  onChange={(e) => setPrizeValueUsd(e.target.value)}
                  required
                  className="w-28 rounded-lg border border-slate-300 pl-6 pr-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#1a2947]"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Prize (CAD)
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">$</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={prizeValueCad}
                  onChange={(e) => setPrizeValueCad(e.target.value)}
                  required
                  className="w-28 rounded-lg border border-slate-300 pl-6 pr-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#1a2947]"
                />
              </div>
            </div>
            <button
              type="submit"
              disabled={settingsSaving}
              className="text-sm font-semibold bg-[#1a2947] text-white rounded-lg px-4 py-2 hover:bg-[#243a63] transition-colors duration-150 disabled:opacity-60"
            >
              {settingsSaving ? 'Saving…' : 'Save Settings'}
            </button>
            {settingsSaved && (
              <span className="text-sm text-green-600 font-medium">Saved ✓</span>
            )}
          </form>
        )}
        {settingsError && (
          <p className="text-red-600 text-sm mt-3">{settingsError}</p>
        )}
        <p className="text-xs text-slate-400 mt-3">
          Controls when the entry form is live on the public site. Times are
          in your local timezone.
        </p>
      </div>

      {loading ? (
        <p className="text-slate-500">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="text-slate-500">No entries yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="text-left font-medium px-4 py-3">Name</th>
                <th className="text-left font-medium px-4 py-3">Email</th>
                <th className="text-left font-medium px-4 py-3">Destination</th>
                <th className="text-left font-medium px-4 py-3">Entered</th>
                <th className="text-left font-medium px-4 py-3">Winner</th>
                <th className="text-right font-medium px-4 py-3">Action</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr
                  key={entry.id}
                  className={`border-t border-slate-100 ${
                    entry.is_winner ? 'bg-amber-50' : ''
                  }`}
                >
                  <td className="px-4 py-3 text-slate-900">{entry.name}</td>
                  <td className="px-4 py-3 text-slate-700">{entry.email}</td>
                  <td className="px-4 py-3 text-slate-700">{entry.destination}</td>
                  <td className="px-4 py-3 text-slate-500">
                    {new Date(entry.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3">
                    {entry.is_winner ? (
                      <span className="inline-block bg-amber-400 text-amber-950 text-xs font-semibold px-2 py-1 rounded-full">
                        🏆 Winner
                      </span>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => markWinner(entry.id)}
                      disabled={actionId === entry.id}
                      className={`text-xs font-semibold rounded-lg px-3 py-1.5 transition-colors duration-150 disabled:opacity-50 ${
                        entry.is_winner
                          ? 'text-amber-700 border border-amber-300 hover:bg-amber-100'
                          : 'text-[#1a2947] border border-[#1a2947] hover:bg-[#1a2947] hover:text-white'
                      }`}
                    >
                      {actionId === entry.id
                        ? 'Updating…'
                        : entry.is_winner
                        ? 'Unmark winner'
                        : 'Mark as winner'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default AdminGiveawayEntries;