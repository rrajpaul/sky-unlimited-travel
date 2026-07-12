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

const AdminGiveawayEntries = () => {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionId, setActionId] = useState(null);

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
                    {!entry.is_winner && (
                      <button
                        onClick={() => markWinner(entry.id)}
                        disabled={actionId === entry.id}
                        className="text-xs font-semibold text-[#1a2947] border border-[#1a2947] rounded-lg px-3 py-1.5 hover:bg-[#1a2947] hover:text-white transition-colors duration-150 disabled:opacity-50"
                      >
                        {actionId === entry.id ? 'Marking…' : 'Mark as winner'}
                      </button>
                    )}
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