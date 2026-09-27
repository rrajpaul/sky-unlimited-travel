const axios = require('axios');
const { config } = require('../config');

/**
 * Checks the main website's giveaway settings endpoint and returns the
 * currently active giveaway, or null if there isn't one right now.
 *
 * "Active" is judged the same way the giveaway API itself judges it for
 * accepting entries — current time between startDate and endDate — rather
 * than just "a giveaway is configured", since a past giveaway's row can
 * still exist (and this endpoint will still return it) even after its
 * window has closed, until someone explicitly archives it there.
 *
 * This fails CLOSED: a 404 (nothing ever configured), a network error, or
 * any unexpected response shape all result in null (no giveaway post) —
 * never in throwing and breaking the run for the two regular daily posts,
 * and never in posting a broken giveaway ad because the fetch half-failed.
 */
async function getActiveGiveaway() {
  let data;
  try {
    const res = await axios.get(config.giveawayApiUrl, { timeout: 8000 });
    data = res.data;
  } catch (err) {
    if (err.response?.status === 404) {
      return null; // no giveaway has ever been configured — not an error
    }
    console.error('[giveaway] Failed to fetch giveaway settings:', err.message);
    return null;
  }

  const start = new Date(data.startDate);
  const end = new Date(data.endDate);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    console.error('[giveaway] Giveaway settings had an unparseable date, skipping:', data);
    return null;
  }

  const now = new Date();
  if (now < start || now > end) {
    return null; // configured, but not currently within its window
  }

  const destinations = Array.isArray(data.destinations) ? data.destinations : [];

  return {
    id: data.id,
    start,
    end,
    prizeValueUsd: data.prizeValueUsd,
    prizeValueCad: data.prizeValueCad,
    destinations,
  };
}

module.exports = { getActiveGiveaway };