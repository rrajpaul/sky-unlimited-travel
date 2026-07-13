import React, { useState, useEffect } from 'react';
import { apiUrl } from '@/lib/api';

/**
 * GiveawaySection
 *
 * Drop this into your page (e.g. HomePage.jsx) wherever you want the
 * giveaway banner + entry form to appear, e.g.:
 *
 *   import GiveawaySection from '@/components/GiveawaySection';
 *   ...
 *   <GiveawaySection />
 *
 * Everything (dates, prize amount, active destinations) comes from
 * GET /api/giveaway/settings — set from AdminGiveawayEntries.jsx. When only
 * one destination is active (e.g. just Jamaica), the destination picker is
 * hidden entirely and that destination is submitted automatically. When
 * more than one is active, a dropdown appears with those options plus
 * "Either — surprise me".
 */

const formatDate = (date) =>
  date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

const formatDestinationList = (destinations) => {
  if (!destinations || destinations.length === 0) return '';
  if (destinations.length === 1) return destinations[0];
  if (destinations.length === 2) return `${destinations[0]} or ${destinations[1]}`;
  return `${destinations.slice(0, -1).join(', ')}, or ${destinations[destinations.length - 1]}`;
};

const GiveawaySection = () => {
  const [form, setForm] = useState({ name: '', email: '', destination: '' });
  const [status, setStatus] = useState('idle'); // idle | submitting | success | error
  const [errorMessage, setErrorMessage] = useState('');

  const [settings, setSettings] = useState(null); // { start, end, prizeValueUsd, prizeValueCad, destinations }
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsError, setSettingsError] = useState(false);

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const res = await fetch(apiUrl('/api/giveaway/settings'));
        if (!res.ok) throw new Error('Failed to load giveaway settings');
        const data = await res.json();
        const loaded = {
          start: new Date(data.startDate),
          end: new Date(data.endDate),
          prizeValueUsd: data.prizeValueUsd,
          prizeValueCad: data.prizeValueCad,
          destinations: data.destinations || [],
        };
        setSettings(loaded);
        // If there's only one destination, pre-fill it since there's no
        // real choice for the visitor to make.
        if (loaded.destinations.length === 1) {
          setForm((f) => ({ ...f, destination: loaded.destinations[0] }));
        } else if (loaded.destinations.length > 1) {
          setForm((f) => ({ ...f, destination: loaded.destinations[0] }));
        }
      } catch (err) {
        console.error('Giveaway settings load error:', err);
        setSettingsError(true);
      } finally {
        setSettingsLoading(false);
      }
    };
    loadSettings();
  }, []);

  const now = new Date();
  const giveawayStatus = settingsLoading
    ? 'loading'
    : settingsError || !settings
    ? 'unknown'
    : now < settings.start
    ? 'upcoming'
    : now > settings.end
    ? 'ended'
    : 'active';

  const multipleDestinations = settings?.destinations?.length > 1;

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim() || !form.email.trim()) return;
    if (giveawayStatus !== 'active') return;

    setStatus('submitting');
    setErrorMessage('');
    try {
      const res = await fetch(apiUrl('/api/giveaway'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.error || 'Submission failed');
      }

      setStatus('success');
      setForm({ name: '', email: '', destination: settings?.destinations?.[0] || '' });
    } catch (err) {
      setStatus('error');
      setErrorMessage(err.message || 'Something went wrong — please try again.');
    }
  };

  if (giveawayStatus === 'loading') {
    return null;
  }

  const destinationLabel = settings ? formatDestinationList(settings.destinations) : '';

  return (
    <section
      id="giveaway"
      className="bg-[#1a2947] text-white py-16 md:py-20"
      aria-labelledby="giveaway-heading"
    >
      <div className="max-w-3xl mx-auto px-6 text-center">
        <p className="uppercase tracking-widest text-xs font-semibold text-blue-200/80 mb-3">
          Limited-time giveaway
        </p>
        <h2
          id="giveaway-heading"
          className="text-3xl md:text-4xl font-bold mb-4"
        >
          {settings
            ? `Win $${settings.prizeValueUsd} off your ${destinationLabel} trip`
            : 'Win big off your next trip'}
        </h2>
        <p className="text-white/70 mb-2 max-w-xl mx-auto">
          Enter for a chance to win a credit toward any Sky Unlimited
          Travel package to {destinationLabel || 'your destination'}. No
          purchase necessary{multipleDestinations ? " — just tell us where you'd rather go." : '.'}
        </p>
        {settings && (
          <p className="text-white/50 text-sm mb-6 max-w-xl mx-auto">
            ${settings.prizeValueUsd} USD / ${settings.prizeValueCad} CAD
          </p>
        )}

        {giveawayStatus !== 'unknown' && settings && (
          <p className="text-blue-200/70 text-sm mb-8 -mt-4">
            {giveawayStatus === 'upcoming' && `Entries open ${formatDate(settings.start)}`}
            {giveawayStatus === 'active' && `Enter by ${formatDate(settings.end)}`}
            {giveawayStatus === 'ended' && `Entries closed ${formatDate(settings.end)}`}
          </p>
        )}

        {giveawayStatus === 'unknown' && (
          <div className="bg-white/10 border border-white/20 rounded-xl px-6 py-8 max-w-md mx-auto">
            <p className="text-lg font-semibold mb-1">Giveaway coming soon</p>
            <p className="text-white/70 text-sm">Check back shortly!</p>
          </div>
        )}

        {giveawayStatus === 'upcoming' && (
          <div className="bg-white/10 border border-white/20 rounded-xl px-6 py-8 max-w-md mx-auto">
            <p className="text-lg font-semibold mb-1">Coming soon</p>
            <p className="text-white/70 text-sm">
              Entries open {formatDate(settings.start)}. Check back then!
            </p>
          </div>
        )}

        {giveawayStatus === 'ended' && (
          <div className="bg-white/10 border border-white/20 rounded-xl px-6 py-8 max-w-md mx-auto">
            <p className="text-lg font-semibold mb-1">This giveaway has ended</p>
            <p className="text-white/70 text-sm">
              Thanks to everyone who entered — stay tuned for the next one!
            </p>
          </div>
        )}

        {giveawayStatus === 'active' && (status === 'success' ? (
          <div
            role="status"
            className="bg-white/10 border border-white/20 rounded-xl px-6 py-8 max-w-md mx-auto"
          >
            <p className="text-lg font-semibold mb-1">You're entered! 🎉</p>
            <p className="text-white/70 text-sm">
              We'll email the winner directly. Good luck!
            </p>
          </div>
        ) : (
          <form
            onSubmit={handleSubmit}
            className="bg-white rounded-xl p-6 md:p-8 max-w-md mx-auto text-left shadow-lg"
          >
            <div className="mb-4">
              <label
                htmlFor="giveaway-name"
                className="block text-sm font-medium text-slate-700 mb-1"
              >
                Full name
              </label>
              <input
                id="giveaway-name"
                name="name"
                type="text"
                required
                value={form.name}
                onChange={handleChange}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#1a2947]"
                placeholder="Jane Smith"
              />
            </div>

            <div className="mb-4">
              <label
                htmlFor="giveaway-email"
                className="block text-sm font-medium text-slate-700 mb-1"
              >
                Email address
              </label>
              <input
                id="giveaway-email"
                name="email"
                type="email"
                required
                value={form.email}
                onChange={handleChange}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#1a2947]"
                placeholder="jane@email.com"
              />
            </div>

            {multipleDestinations && (
              <div className="mb-6">
                <label
                  htmlFor="giveaway-destination"
                  className="block text-sm font-medium text-slate-700 mb-1"
                >
                  Which trip are you hoping for?
                </label>
                <select
                  id="giveaway-destination"
                  name="destination"
                  value={form.destination}
                  onChange={handleChange}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#1a2947]"
                >
                  {settings.destinations.map((dest) => (
                    <option key={dest} value={dest}>{dest}</option>
                  ))}
                  <option value="Either">Either — surprise me</option>
                </select>
              </div>
            )}

            <button
              type="submit"
              disabled={status === 'submitting'}
              className="w-full bg-[#1a2947] text-white font-semibold rounded-lg py-3 hover:bg-[#243a63] transition-colors duration-200 disabled:opacity-60"
            >
              {status === 'submitting' ? 'Entering…' : 'Enter Now'}
            </button>

            {status === 'error' && (
              <p role="alert" className="text-red-600 text-sm mt-3">
                {errorMessage}
              </p>
            )}

            <p className="text-xs text-slate-400 mt-4 text-center">
              No purchase necessary. One entry per person. See{' '}
              <a href="/giveaway-rules" className="underline hover:text-slate-600">
                official rules
              </a>
              .
            </p>
          </form>
        ))}
      </div>
    </section>
  );
};

export default GiveawaySection;