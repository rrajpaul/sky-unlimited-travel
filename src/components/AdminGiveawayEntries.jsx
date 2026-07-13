import React, { useEffect, useState } from 'react';
import { apiUrl } from '@/lib/api';

function getToken() {
  return localStorage.getItem('adminToken');
}

function toDatetimeLocalValue(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Keep in sync with ALLOWED_DESTINATIONS in routes/giveaway.js
const ALL_DESTINATIONS = ['Bahamas', 'Jamaica'];

const AdminGiveawayEntries = () => {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionId, setActionId] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');

  // --- Giveaway window + prize settings ---
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [prizeValueUsd, setPrizeValueUsd] = useState('');
  const [prizeValueCad, setPrizeValueCad] = useState('');
  const [destinations, setDestinations] = useState([]);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsError, setSettingsError] = useState('');
  const [settingsSaved, setSettingsSaved] = useState(false);

  const loadSettings = async () => {
    setSettingsLoading(true);
    setSettingsError('');
    try {
      const res = await fetch(apiUrl('/api/giveaway/settings'));
      if (!res.ok) throw new Error('Failed to load giveaway settings');
      const data = await res.json();
      setStartDate(toDatetimeLocalValue(data.startDate));
      setEndDate(toDatetimeLocalValue(data.endDate));
      setPrizeValueUsd(String(data.prizeValueUsd ?? ''));
      setPrizeValueCad(String(data.prizeValueCad ?? ''));
      setDestinations(Array.isArray(data.destinations) ? data.destinations : []);
    } catch (err) {
      setSettingsError(err.message || 'Failed to load giveaway settings');
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
          destinations,
        }),
      });

      if (res.status === 401) {
        localStorage.removeItem('adminToken');
        window.location.href = '/admin';
        return;
      }

      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to save settings');
      setSettingsSaved(true);
      setTimeout(() => setSettingsSaved(false), 3000);
    } catch (err) {
      setSettingsError(err.message || 'Failed to save settings');
    } finally {
      setSettingsSaving(false);
    }
  };

  const toggleDestination = (dest) => {
    setDestinations((prev) =>
      prev.includes(dest) ? prev.filter((d) => d !== dest) : [...prev, dest]
    );
  };

  // --- Entries ---
  const loadEntries = async () => {
    setLoading(true);
    setError('');

    try {
      const res = await fetch(apiUrl('/api/giveaway'), {
        headers: {
          Authorization: `Bearer ${getToken()}`,
        },
      });

      if (res.status === 401) {
        localStorage.removeItem('adminToken');
        window.location.href = '/admin';
        return;
      }

      if (!res.ok) {
        throw new Error('Failed to load entries');
      }

      const data = await res.json();

      data.sort(
        (a, b) => new Date(b.created_at) - new Date(a.created_at)
      );

      setEntries(data);
    } catch (err) {
      setError(err.message || 'Failed to load entries');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!getToken()) {
      window.location.href = '/admin';
      return;
    }

    loadEntries();
    loadSettings();
  }, []);

  const handleToggleWinner = async (entry) => {
    setActionId(entry.id);

    try {
      const res = await fetch(
        apiUrl(`/api/giveaway/${entry.id}/winner`),
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${getToken()}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            is_winner: !entry.is_winner,
          }),
        }
      );

      if (res.status === 401) {
        localStorage.removeItem('adminToken');
        window.location.href = '/admin';
        return;
      }

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed');
      }

      loadEntries();
    } catch (err) {
      console.error(err);
      alert('Failed to update winner status');
    } finally {
      setActionId(null);
    }
  };

  const filteredEntries = entries.filter((entry) => {
    const search = searchTerm.toLowerCase();

    return (
      entry.name?.toLowerCase().includes(search) ||
      entry.email?.toLowerCase().includes(search) ||
      entry.destination?.toLowerCase().includes(search) ||
      new Date(entry.created_at)
        .toLocaleDateString()
        .toLowerCase()
        .includes(search)
    );
  });

  const WinnerToggle = ({ entry }) => (
    <div className="flex items-center gap-3">
      <button
        onClick={() => handleToggleWinner(entry)}
        disabled={actionId === entry.id}
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 shrink-0 ${
          entry.is_winner ? 'bg-green-500' : 'bg-gray-300'
        } ${actionId === entry.id ? 'opacity-50 cursor-not-allowed' : ''}`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform duration-200 ${
            entry.is_winner ? 'translate-x-6' : 'translate-x-1'
          }`}
        />
      </button>
      <span
        className={`text-sm font-semibold ${
          entry.is_winner ? 'text-green-600' : 'text-gray-500'
        }`}
      >
        {entry.is_winner ? 'Winner' : 'Not Winner'}
      </span>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">

        <div className="flex flex-wrap justify-between items-center gap-3 mb-8">
          <h1 className="text-2xl font-bold text-gray-900">
            Giveaway Entries
          </h1>

          <div className="flex gap-3">
            <button
              onClick={loadEntries}
              className="px-4 py-2 text-sm font-medium rounded-md text-indigo-600 bg-indigo-50 hover:bg-indigo-100 transition-colors"
            >
              Refresh
            </button>

            <a
              href="/admin"
              className="px-4 py-2 text-sm font-medium rounded-md text-indigo-600 bg-indigo-50 hover:bg-indigo-100 transition-colors"
            >
              Travel Registrations
            </a>
          </div>
        </div>

        {/* Giveaway window + prize settings */}
        <div className="bg-white rounded-lg shadow mb-6 px-4 sm:px-6 py-5">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">
            Giveaway Settings
          </h2>

          {settingsLoading ? (
            <p className="text-gray-500 text-sm">Loading settings…</p>
          ) : (
            <form onSubmit={saveSettings} className="flex flex-wrap items-end gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Start date
                </label>
                <input
                  type="datetime-local"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  required
                  className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  End date
                </label>
                <input
                  type="datetime-local"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  required
                  className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Prize (USD)
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={prizeValueUsd}
                    onChange={(e) => setPrizeValueUsd(e.target.value)}
                    required
                    className="w-28 rounded-md border border-gray-300 pl-6 pr-3 py-2 text-sm text-gray-900 shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Prize (CAD)
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={prizeValueCad}
                    onChange={(e) => setPrizeValueCad(e.target.value)}
                    required
                    className="w-28 rounded-md border border-gray-300 pl-6 pr-3 py-2 text-sm text-gray-900 shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Destinations
                </label>
                <div className="flex gap-3 pt-1.5">
                  {ALL_DESTINATIONS.map((dest) => (
                    <label key={dest} className="flex items-center gap-1.5 text-sm text-gray-700">
                      <input
                        type="checkbox"
                        checked={destinations.includes(dest)}
                        onChange={() => toggleDestination(dest)}
                        className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      {dest}
                    </label>
                  ))}
                </div>
              </div>

              <button
                type="submit"
                disabled={settingsSaving || destinations.length === 0}
                className="px-4 py-2 text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 transition-colors disabled:opacity-60"
              >
                {settingsSaving ? 'Saving…' : 'Save Settings'}
              </button>
              {settingsSaved && (
                <span className="text-sm text-green-600 font-medium">Saved ✓</span>
              )}
              {destinations.length === 0 && (
                <span className="text-sm text-red-500">Select at least one destination</span>
              )}
            </form>
          )}

          {settingsError && (
            <p className="text-red-600 text-sm mt-3">{settingsError}</p>
          )}

          <p className="text-xs text-gray-400 mt-3">
            Controls when the entry form is live on the public site, and the
            prize amount shown there. Times are in your local timezone.
          </p>
        </div>

        <div className="bg-white rounded-lg shadow overflow-hidden">

          <div className="px-4 sm:px-6 py-4 border-b border-gray-200">
            <input
              type="text"
              placeholder="Search name, email or destination..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full sm:w-96 px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
            />
          </div>

          {error && (
            <div className="mx-4 sm:mx-6 mt-4 bg-red-50 border border-red-200 text-red-700 rounded-md px-4 py-3">
              {error}
            </div>
          )}

          {loading ? (
            <div className="p-6 text-gray-500">
              Loading entries...
            </div>
          ) : filteredEntries.length === 0 ? (
            <div className="p-6 text-gray-500">
              No giveaway entries found.
            </div>
          ) : (
            <>
              {/* Mobile card layout */}
              <div className="block sm:hidden divide-y divide-gray-200">
                {filteredEntries.map((entry) => (
                  <div
                    key={entry.id}
                    className={`p-4 ${entry.is_winner ? 'bg-amber-50' : ''}`}
                  >
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-gray-900 truncate">
                          {entry.name}
                        </p>
                        <p className="text-xs text-gray-500 truncate">
                          {entry.email}
                        </p>
                      </div>
                      <p className="text-xs text-gray-400 shrink-0 text-right">
                        {new Date(entry.created_at).toLocaleDateString()}
                      </p>
                    </div>

                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-0.5">
                          Destination
                        </p>
                        <p className="text-sm text-gray-800">
                          {entry.destination || '—'}
                        </p>
                      </div>
                      <WinnerToggle entry={entry} />
                    </div>
                  </div>
                ))}
              </div>

              {/* Desktop table layout */}
              <div className="hidden sm:block overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Name
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Email
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Destination
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Entered
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Winner
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {filteredEntries.map((entry) => (
                      <tr
                        key={entry.id}
                        className={entry.is_winner ? 'bg-amber-50' : ''}
                      >
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                          {entry.name}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                          {entry.email}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                          {entry.destination}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {new Date(entry.created_at).toLocaleString()}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <WinnerToggle entry={entry} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

        </div>
      </div>
    </div>
  );
};

export default AdminGiveawayEntries;