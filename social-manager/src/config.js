require('dotenv').config();

function required(name, fallback) {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    // Don't throw at import time for every field — only the ones actually
    // needed for the action being taken (e.g. /preview doesn't need FB creds).
    return undefined;
  }
  return value;
}

const config = {
  port: Number(process.env.PORT || 3000),
  publicBaseUrl: required('PUBLIC_BASE_URL'),

  anthropicApiKey: required('ANTHROPIC_API_KEY'),

  // Postgres connection string — reuses the MAIN WEBSITE's existing
  // database (a separate app from this one). Post history is stored there
  // in its own table (social_post_history), not a new database.
  databaseUrl: required('DATABASE_URL'),

  graphApiVersion: process.env.GRAPH_API_VERSION || 'v21.0',
  fbPageId: required('FB_PAGE_ID'),
  fbPageAccessToken: required('FB_PAGE_ACCESS_TOKEN'),
  igBusinessAccountId: required('IG_BUSINESS_ACCOUNT_ID'),

  // Cron times for each scheduled post. POST_CRON is always used; POST_CRON_2
  // is optional — set it to run a second post at a different time each day
  // (e.g. one post timed for Facebook's morning peak, another for
  // Instagram's evening peak). Empty/unset means single-post-per-day, same
  // as before.
  postCron: process.env.POST_CRON || '0 11 * * *',
  // Distinguish "not set at all" (use the default) from "explicitly set to
  // empty" (disable the second post) — a plain `|| fallback` can't tell
  // these apart, since an empty string is falsy in JS and would silently
  // fall back to the default even when someone deliberately blanked it out.
  postCron2:
    process.env.POST_CRON_2 === undefined ? '0 19 * * *' : process.env.POST_CRON_2,
  timezone: process.env.TIMEZONE || 'America/New_York',

  // --- Giveaway posting ---
  // Public settings endpoint on the main website's server (a SEPARATE app
  // from this one — see server/routes/giveaway.js there). Polled once per
  // scheduled run to decide whether a giveaway is currently active; nothing
  // here writes to that system, this only ever reads from it.
  giveawayApiUrl:
    process.env.GIVEAWAY_API_URL || 'https://www.skyunlimitedtravel.com/api/giveaway/settings',
  // Where the caption sends people to actually enter.
  giveawayPageUrl:
    process.env.GIVEAWAY_PAGE_URL || 'https://www.skyunlimitedtravel.com/#giveaway',
  // Third daily post, independent of POST_CRON/POST_CRON_2 — only actually
  // posts when a giveaway is active (see giveawayService.js); silently does
  // nothing otherwise, so leaving this on year-round is safe.
  giveawayPostCron: process.env.GIVEAWAY_POST_CRON || '0 15 * * *',

  // --- Manual flyer upload page (/flyer) ---
  // Simple HTTP Basic Auth credentials gating the manual flyer-upload page
  // — that page posts directly to the real Facebook/Instagram accounts the
  // moment someone submits the form, so it's protected even though the
  // rest of this app's API has no auth of its own (those routes all need
  // curl/a terminal to use; a web form is the kind that gets bookmarked or
  // forwarded by accident). No fallback default on purpose — if these
  // aren't set, the /flyer page refuses to serve rather than silently
  // running unprotected.
  flyerUploadUser: process.env.FLYER_UPLOAD_USER,
  flyerUploadPassword: process.env.FLYER_UPLOAD_PASSWORD,

  brand: {
    name: process.env.BRAND_NAME || 'Sky Unlimited Travel',
    tagline:
      process.env.BRAND_TAGLINE ||
      'Premium travel booking for flights, hotels, and vacation packages',
    accentColor: process.env.BRAND_ACCENT_COLOR || '#1a2947',
  },
};

function assertConfigured(keys) {
  const missing = keys.filter((k) => !config[k]);
  if (missing.length) {
    throw new Error(
      `Missing required configuration: ${missing.join(', ')}. Check your .env file (see .env.example).`
    );
  }
}

module.exports = { config, assertConfigured };