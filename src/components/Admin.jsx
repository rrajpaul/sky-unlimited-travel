import React, { useState, useEffect } from 'react';
import { apiUrl } from '@/lib/api';
import { ChevronDown, ChevronRight } from 'lucide-react';

const AdminPage = () => {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [loginForm, setLoginForm] = useState({ username: '', password: '' });
  const [loading, setLoading] = useState(true);
  const [registrations, setRegistrations] = useState([]);
  const [error, setError] = useState('');
  const [expandedRows, setExpandedRows] = useState({});
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    const checkAuth = async () => {
      const token = localStorage.getItem('adminToken');

      if (!token) {
        setLoading(false);
        return;
      }

      try {
        const res = await fetch(apiUrl('/api/admin/verify'), {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        const data = await res.json();

        if (res.ok && data.valid) {
          setIsLoggedIn(true);
          loadRegistrations();
        } else {
          localStorage.removeItem('adminToken');
          setIsLoggedIn(false);
        }
      } catch (err) {
        console.error('Auth verification failed:', err);
        localStorage.removeItem('adminToken');
        setIsLoggedIn(false);
      } finally {
        setLoading(false);
      }
    };

    checkAuth();
  }, []);

  const loadRegistrations = async () => {
    try {
      const token = localStorage.getItem('adminToken');

      const res = await fetch(apiUrl('/api/inquiry'), {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await res.json();

      setRegistrations(data);
    } catch (err) {
      console.error('Error fetching registrations:', err);
    }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');

    if (!loginForm.username || !loginForm.password) {
      setError('Please fill in all fields');
      return;
    }

    try {
      const res = await fetch(apiUrl('/api/admin/login'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username: loginForm.username,
          password: loginForm.password,
        }),
      });

      const data = await res.json();

      if (res.ok && data.success && data.token) {

        // store token
        localStorage.setItem('adminToken', data.token);

        // verify token with backend
        const verifyRes = await fetch(apiUrl('/api/admin/verify'), {
          headers: {
            Authorization: `Bearer ${data.token}`,
          },
        });

        const verifyData = await verifyRes.json();

        if (verifyRes.ok && verifyData.valid) {
          setIsLoggedIn(true);
          loadRegistrations();
        } else {
          localStorage.removeItem('adminToken');
          setError('Session invalid');
        }

      } else {
        setError(data.message || 'Invalid credentials');
      }

    } catch (err) {
      console.error('Login error:', err);
      setError('Server error. Please try again.');
    }
  };

  const handleLogout = async () => {
    const token = localStorage.getItem('adminToken');

    try {
      await fetch(apiUrl('/api/admin/logout'), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
    } catch (err) {
      console.error('Logout error:', err);
    }

    localStorage.removeItem('adminToken');
    setIsLoggedIn(false);
    setLoginForm({ username: '', password: '' });

    window.location.href = '/admin';
  };

  const toggleRow = (id) => {
    setExpandedRows(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const handleSendPaymentLink = async (registration) => {
    try {
      const res = await fetch(apiUrl(`/api/inquiry/${registration.id}/send-payment-link`), {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      alert(`Payment link sent to ${registration.email}!`);
      loadRegistrations();
    } catch (err) {
      console.error('Error sending payment link:', err);
      alert('Failed to send payment link');
    }
  };

  const handleTogglePayment = async (registration) => {
    const newStatus = registration.payment_status === 'paid' ? 'unpaid' : 'paid';
    try {
      const res = await fetch(apiUrl(`/api/inquiry/${registration.id}/payment-status`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payment_status: newStatus }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      loadRegistrations();
    } catch (err) {
      console.error('Error toggling payment status:', err);
      alert('Failed to update payment status');
    }
  };

  const formatDate = (date) => date ? new Date(date).toLocaleDateString() : '—';

  const filteredRegistrations = registrations.filter((reg) => {
    const search = searchTerm.toLowerCase();

    return (
      reg.name?.toLowerCase().includes(search) ||
      reg.email?.toLowerCase().includes(search) ||
      reg.country?.toLowerCase().includes(search) ||
      reg.city?.toLowerCase().includes(search) ||
      formatDate(reg.created_at).toLowerCase().includes(search)
    );
  });

  if (!isLoggedIn) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-lg shadow-md p-8 w-full max-w-md">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-gray-900">Admin Login</h1>
            <p className="mt-2 text-gray-600">Sign in to manage travel registrations</p>
          </div>
          {error && (
            <div className="mb-6 bg-red-50 text-red-700 px-4 py-3 rounded-md">{error}</div>
          )}
          <form onSubmit={handleLogin}>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">Username</label>
              <input
                type="text"
                value={loginForm.username}
                onChange={(e) => setLoginForm({ ...loginForm, username: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                placeholder="Enter your username"
              />
            </div>
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
              <input
                type="password"
                value={loginForm.password}
                onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                placeholder="Enter your password"
              />
            </div>
            <button
              type="submit"
              className="w-full bg-indigo-600 text-white py-2 px-4 rounded-md hover:bg-indigo-700 transition-colors duration-200"
            >
              Sign In
            </button>
          </form>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading registrations...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Travel Registrations</h1>
          <div className="flex items-center gap-3">
            <a
              href="/"
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-2 text-sm font-medium rounded-md text-indigo-600 bg-indigo-50 hover:bg-indigo-100 transition-colors duration-200"
            >
              Open Main Site
            </a>

            <button
              onClick={handleLogout}
              className="px-4 py-2 text-sm font-medium rounded-md text-white bg-gray-600 hover:bg-gray-700 transition-colors duration-200"
            >
              Logout
            </button>
          </div>
        </div>

        <div className="bg-white shadow rounded-lg overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
          <input
            type="text"
            placeholder="Search customer, destination, or submitted date..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full sm:w-96 px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
          />
        </div>
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-xl font-semibold text-gray-900">Manage Travel Bookings</h2>
            <p className="mt-1 text-sm text-gray-500">Tap a row to expand details, send payment links, and manage status</p>
          </div>

          {/* Mobile card layout */}
          <div className="block sm:hidden divide-y divide-gray-200">
            {filteredRegistrations.map((reg) => (
              <div key={reg.id} className="p-4">
                <button
                  onClick={() => toggleRow(reg.id)}
                  className="w-full text-left flex items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="h-10 w-10 bg-indigo-100 rounded-full flex items-center justify-center shrink-0">
                      <span className="text-sm font-medium text-indigo-800">{reg.name.charAt(0)}</span>
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-900 truncate">{reg.name}</p>
                      <p className="text-xs text-gray-500 truncate">{reg.email}</p>
                      <p className="text-xs text-gray-500">{reg.country}{reg.city ? `, ${reg.city}` : ''}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {/* Submitted replaces Paid/Unpaid badge in mobile parent row */}
                    <div className="text-right">
                      <p className="text-xs text-gray-400">Submitted</p>
                      <p className="text-xs font-medium text-gray-700">{formatDate(reg.created_at)}</p>
                    </div>
                    {expandedRows[reg.id]
                      ? <ChevronDown className="w-4 h-4 text-gray-400" />
                      : <ChevronRight className="w-4 h-4 text-gray-400" />
                    }
                  </div>
                </button>

                {expandedRows[reg.id] && (
                  <div className="mt-4 pt-4 border-t border-gray-100 space-y-4">

                    {/* Mobile Row 1 — From Date, To Date, Additional Details spans 2 */}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">From Date</p>
                        <p className="text-sm text-gray-800 mt-0.5">{reg.from_date ? formatDate(reg.from_date) : '—'}</p>
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">To Date</p>
                        <p className="text-sm text-gray-800 mt-0.5">{reg.to_date ? formatDate(reg.to_date) : '—'}</p>
                      </div>
                      <div className="col-span-2">
                        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Additional Details</p>
                        <p className="text-sm text-gray-700 mt-0.5">{reg.details || 'No additional details provided.'}</p>
                      </div>
                    </div>

                    {/* Mobile Row 2 — Action, Link Sent, Toggle, Payment */}
                    <div className="grid grid-cols-2 gap-3 pt-3 border-t border-gray-100">
                      <div>
                        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Action</p>
                        <button
                          onClick={() => handleSendPaymentLink(reg)}
                          disabled={reg.payment_status === 'paid'}
                          className="w-full text-center px-3 py-2 text-xs font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-200"
                        >
                          {reg.payment_link_sent ? 'Resend Link' : 'Send Link - Pending'}
                        </button>
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Link Sent</p>
                        <p className="text-sm text-gray-800 mt-0.5">{reg.payment_link_sent ? formatDate(reg.payment_link_sent_at) : '—'}</p>
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Paid / Unpaid</p>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleTogglePayment(reg)}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 ${
                              reg.payment_status === 'paid' ? 'bg-green-500' : 'bg-gray-300'
                            }`}
                          >
                            <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform duration-200 ${
                              reg.payment_status === 'paid' ? 'translate-x-6' : 'translate-x-1'
                            }`} />
                          </button>
                          <span className={`text-xs font-semibold ${reg.payment_status === 'paid' ? 'text-green-600' : 'text-yellow-600'}`}>
                            {reg.payment_status === 'paid' ? 'Paid' : 'Unpaid'}
                          </span>
                        </div>
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Payment</p>
                        <span className={`inline-block mt-0.5 px-2 py-0.5 text-xs font-medium rounded-full ${
                          reg.payment_status === 'paid' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
                        }`}>
                          {reg.payment_status === 'paid'
                            ? `Paid${reg.payment_paid_at ? ` · ${formatDate(reg.payment_paid_at)}` : ''}`
                            : 'Unpaid'}
                        </span>
                      </div>
                    </div>

                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Desktop table layout */}
          <div className="hidden sm:block overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 w-8"></th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Customer</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Destination</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Phone</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Submitted</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredRegistrations.map((reg) => (
                  <React.Fragment key={reg.id}>
                    <tr
                      className="hover:bg-gray-50 cursor-pointer"
                      onClick={() => toggleRow(reg.id)}
                    >
                      <td className="px-4 py-4">
                        {expandedRows[reg.id]
                          ? <ChevronDown className="w-4 h-4 text-gray-400" />
                          : <ChevronRight className="w-4 h-4 text-gray-400" />
                        }
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          <div className="h-10 w-10 bg-indigo-100 rounded-full flex items-center justify-center shrink-0">
                            <span className="text-sm font-medium text-indigo-800">{reg.name.charAt(0)}</span>
                          </div>
                          <div className="ml-4">
                            <div className="text-sm font-medium text-gray-900">{reg.name}</div>
                            <div className="text-sm text-gray-500">{reg.email}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {reg.country}{reg.city ? `, ${reg.city}` : ''}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {reg.phone || 'N/A'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {formatDate(reg.created_at)}
                      </td>
                    </tr>

                    {expandedRows[reg.id] && (
                      <tr className="bg-indigo-50">
                        <td colSpan={5} className="px-6 py-5 space-y-4">

                          {/* Desktop Row 1 — From Date, To Date, Additional Details spans 2 */}
                          <div className="grid grid-cols-4 gap-6">
                            <div>
                              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">From Date</p>
                              <p className="text-sm text-gray-800">{reg.from_date ? formatDate(reg.from_date) : '—'}</p>
                            </div>
                            <div>
                              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">To Date</p>
                              <p className="text-sm text-gray-800">{reg.to_date ? formatDate(reg.to_date) : '—'}</p>
                            </div>
                            <div className="col-span-2">
                              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Additional Details</p>
                              <p className="text-sm text-gray-700">{reg.details || '—'}</p>
                            </div>
                          </div>

                          {/* Desktop Row 2 — Action, Link Sent, Paid/Unpaid, Payment */}
                          <div className="grid grid-cols-4 gap-6 pt-3 border-t border-indigo-100">
                            <div>
                              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Action</p>
                              <button
                                onClick={(e) => { e.stopPropagation(); handleSendPaymentLink(reg); }}
                                disabled={reg.payment_status === 'paid'}
                                className="inline-flex items-center px-3 py-1 text-xs font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-200"
                              >
                                {reg.payment_link_sent ? 'Resend Link' : 'Send Link - Pending'}
                              </button>
                            </div>
                            <div>
                              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Link Sent</p>
                              <p className="text-sm text-gray-800">{reg.payment_link_sent ? formatDate(reg.payment_link_sent_at) : '—'}</p>
                            </div>
                            <div>
                              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Paid / Unpaid</p>
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleTogglePayment(reg); }}
                                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 ${
                                    reg.payment_status === 'paid' ? 'bg-green-500' : 'bg-gray-300'
                                  }`}
                                >
                                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform duration-200 ${
                                    reg.payment_status === 'paid' ? 'translate-x-6' : 'translate-x-1'
                                  }`} />
                                </button>
                                <span className={`text-sm font-semibold ${reg.payment_status === 'paid' ? 'text-green-600' : 'text-yellow-600'}`}>
                                  {reg.payment_status === 'paid' ? 'Paid' : 'Unpaid'}
                                </span>
                              </div>
                            </div>
                            <div>
                              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Payment</p>
                              <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                                reg.payment_status === 'paid' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
                              }`}>
                                {reg.payment_status === 'paid'
                                  ? `Paid${reg.payment_paid_at ? ` · ${formatDate(reg.payment_paid_at)}` : ''}`
                                  : 'Unpaid'}
                              </span>
                            </div>
                          </div>

                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>

          {registrations.length === 0 && (
            <div className="text-center py-12">
              <h3 className="text-sm font-medium text-gray-900">No registrations yet</h3>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AdminPage;