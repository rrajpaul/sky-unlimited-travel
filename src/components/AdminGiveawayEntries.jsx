import React, { useEffect, useState } from 'react';
import { apiUrl } from '@/lib/api';

function getToken() {
  return localStorage.getItem('adminToken');
}

const AdminGiveawayEntries = () => {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionId, setActionId] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');

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

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto px-6 py-8">

        <div className="flex justify-between items-center mb-8">
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

        <div className="bg-white rounded-lg shadow overflow-hidden">

          <div className="px-6 py-4 border-b border-gray-200">
            <input
              type="text"
              placeholder="Search name, email or destination..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full sm:w-96 px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
            />
          </div>

          {error && (
            <div className="mx-6 mt-4 bg-red-50 border border-red-200 text-red-700 rounded-md px-4 py-3">
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
            <div className="overflow-x-auto">

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
                        <div className="flex items-center gap-3">

                          <button
                            onClick={() => handleToggleWinner(entry)}
                            disabled={actionId === entry.id}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 ${
                              entry.is_winner
                                ? 'bg-green-500'
                                : 'bg-gray-300'
                            } ${
                              actionId === entry.id
                                ? 'opacity-50 cursor-not-allowed'
                                : ''
                            }`}
                          >
                            <span
                              className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform duration-200 ${
                                entry.is_winner
                                  ? 'translate-x-6'
                                  : 'translate-x-1'
                              }`}
                            />
                          </button>

                          <span
                            className={`text-sm font-semibold ${
                              entry.is_winner
                                ? 'text-green-600'
                                : 'text-gray-500'
                            }`}
                          >
                            {entry.is_winner
                              ? 'Winner'
                              : 'Not Winner'}
                          </span>

                        </div>
                      </td>

                    </tr>

                  ))}

                </tbody>

              </table>

            </div>
          )}

        </div>
      </div>
    </div>
  );
};

export default AdminGiveawayEntries;