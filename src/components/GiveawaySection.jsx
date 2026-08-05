import React, { useState, useEffect, useRef } from 'react';
import { apiUrl } from '@/lib/api';

const formatDate = (date) =>
  date.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  });

const formatDestinationList = (destinations) => {
  if (!destinations || destinations.length === 0) return '';

  if (destinations.length === 1) {
    return destinations[0];
  }

  if (destinations.length === 2) {
    return `${destinations[0]} or ${destinations[1]}`;
  }

  return `${destinations.slice(0, -1).join(', ')}, or ${
    destinations[destinations.length - 1]
  }`;
};

const GiveawaySection = () => {
  const [form, setForm] = useState({
    name: '',
    email: '',
    destination: '',
    website: ''
  });

  const [turnstileToken, setTurnstileToken] = useState(null);
  const turnstileRef = useRef(null);
  const turnstileWidgetId = useRef(null);

  const [status, setStatus] = useState('idle');
  const [errorMessage, setErrorMessage] = useState('');

  const [settings, setSettings] = useState(null);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsError, setSettingsError] = useState(false);


  useEffect(() => {
    const loadSettings = async () => {
      try {
        const res = await fetch(apiUrl('/api/giveaway/settings'));

        if (!res.ok) {
          throw new Error('Failed to load giveaway settings');
        }

        const data = await res.json();

        const loaded = {
          start: new Date(data.startDate),
          end: new Date(data.endDate),
          prizeValueUsd: data.prizeValueUsd,
          prizeValueCad: data.prizeValueCad,
          destinations: data.destinations || []
        };

        setSettings(loaded);

        if (loaded.destinations.length > 0) {
          setForm((current) => ({
            ...current,
            destination: loaded.destinations[0]
          }));
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


  useEffect(() => {
    if (!settings) return;

    let cancelled = false;
    let pollInterval = null;

    const renderWidget = () => {
      if (
        cancelled ||
        !turnstileRef.current ||
        turnstileWidgetId.current !== null
      ) {
        return;
      }

      turnstileWidgetId.current = window.turnstile.render(
        turnstileRef.current,
        {
          sitekey: import.meta.env.VITE_TURNSTILE_SITE_KEY,

          callback: (token) => {
            setTurnstileToken(token);
          },

          'expired-callback': () => {
            setTurnstileToken(null);
          },

          'error-callback': () => {
            setTurnstileToken(null);
          }
        }
      );
    };


    if (window.turnstile) {
      renderWidget();
    } else {
      pollInterval = setInterval(() => {
        if (window.turnstile) {
          clearInterval(pollInterval);
          pollInterval = null;
          renderWidget();
        }
      }, 100);
    }


    return () => {
      cancelled = true;

      if (pollInterval) {
        clearInterval(pollInterval);
      }

      if (
        window.turnstile &&
        turnstileWidgetId.current !== null
      ) {
        window.turnstile.remove(turnstileWidgetId.current);
        turnstileWidgetId.current = null;
      }
    };

  }, [settings]);


  const resetTurnstile = () => {
    setTurnstileToken(null);

    if (
      window.turnstile &&
      turnstileWidgetId.current !== null
    ) {
      window.turnstile.reset(turnstileWidgetId.current);
    }
  };


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


  const multipleDestinations =
    settings?.destinations?.length > 1;


  const handleChange = (e) => {
    setForm({
      ...form,
      [e.target.name]: e.target.value
    });
  };
  
    const handleSubmit = async (e) => {
    e.preventDefault();

    if (!form.name.trim() || !form.email.trim()) {
      return;
    }

    if (giveawayStatus !== 'active') {
      return;
    }

    if (!turnstileToken) {
      setStatus('error');
      setErrorMessage(
        'Please complete the security verification.'
      );
      return;
    }

    setStatus('submitting');
    setErrorMessage('');

    try {
      const res = await fetch(apiUrl('/api/giveaway'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          ...form,
          turnstileToken
        })
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(
          data?.error || 'Submission failed'
        );
      }

      setStatus('success');

      resetTurnstile();

      setForm({
        name: '',
        email: '',
        destination: settings?.destinations?.[0] || '',
        website: ''
      });

    } catch (err) {
      setStatus('error');

      setErrorMessage(
        err.message ||
        'Something went wrong — please try again.'
      );

      resetTurnstile();
    }
  };


  if (giveawayStatus === 'loading') {
    return null;
  }


  const destinationLabel = settings
    ? formatDestinationList(settings.destinations)
    : '';


  return (
    <section
      id="giveaway"
      className="bg-[#1a2947] text-white pt-8 pb-10 md:pt-12 md:pb-20"
      aria-labelledby="giveaway-heading"
    >
      <div className="max-w-3xl mx-auto px-6 text-center">

        <p className="uppercase tracking-widest text-xs font-semibold text-blue-200/80 mb-2 md:mb-3">
          Limited-time giveaway
        </p>

        <h2
          id="giveaway-heading"
          className="text-2xl md:text-4xl font-bold mb-2 md:mb-4"
        >
          Win ${settings?.prizeValueUsd || 0} USD
          {settings?.prizeValueCad && (
            <> (CA${settings.prizeValueCad} CAD)</>
          )}
          {' '}off your {destinationLabel} trip!
        </h2>


        {settings && (
          <p className="text-white/80 text-sm mb-2 md:mb-4">
            Giveaway runs from{' '}
            <strong>
              {formatDate(settings.start)}
            </strong>{' '}
            to{' '}
            <strong>
              {formatDate(settings.end)}
            </strong>
          </p>
        )}

        {giveawayStatus === 'active' && (

          status === 'success' ? (

            <div
              role="status"
              className="bg-white/10 border border-white/20 rounded-xl px-6 py-8 max-w-md mx-auto"
            >
              <p className="text-lg font-semibold mb-1">
                You're entered! 🎉
              </p>

              <p className="text-white/70 text-sm">
                We'll email the winner directly. Good luck!
              </p>
            </div>

          ) : (

            <form
              onSubmit={handleSubmit}
              className="bg-white rounded-xl p-5 md:p-6 max-w-md mx-auto text-left shadow-lg"
            >

              <div className="mb-3">
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


              <div className="mb-3">

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


                {/* Honeypot */}
                <input
                  id="giveaway-website"
                  name="website"
                  type="text"
                  value={form.website}
                  onChange={handleChange}
                  autoComplete="off"
                  tabIndex="-1"
                  aria-hidden="true"
                  className="absolute left-[-9999px]"
                />

              </div>


              {multipleDestinations && (

                <div className="mb-4">

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
                      <option
                        key={dest}
                        value={dest}
                      >
                        {dest}
                      </option>
                    ))}

                    <option value="Either">
                      Either — surprise me
                    </option>

                  </select>

                </div>

              )}


              <div
                ref={turnstileRef}
                className="mb-4 flex justify-center [&>*]:!scale-90 [&>*]:origin-top"
              />


              <button
                type="submit"
                disabled={status === 'submitting'}
                className="w-full bg-[#1a2947] text-white font-semibold rounded-lg py-2.5 hover:bg-[#243a63] transition-colors duration-200 disabled:opacity-60"
              >
                {status === 'submitting'
                  ? 'Entering…'
                  : 'Enter Now'}
              </button>


              {status === 'error' && (
                <p
                  role="alert"
                  className="text-red-600 text-sm mt-3"
                >
                  {errorMessage}
                </p>
              )}


              <p className="text-xs text-slate-400 mt-3 text-center">
                No purchase necessary. One entry per person. See{' '}
                <a
                  href="/giveaway-rules"
                  className="underline hover:text-slate-600"
                >
                  official rules
                </a>.
              </p>

            </form>

          )
        )}

      </div>
    </section>
  );
};


export default GiveawaySection;