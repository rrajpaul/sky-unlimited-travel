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

  graphApiVersion: process.env.GRAPH_API_VERSION || 'v21.0',
  fbPageId: required('FB_PAGE_ID'),
  fbPageAccessToken: required('FB_PAGE_ACCESS_TOKEN'),
  igBusinessAccountId: required('IG_BUSINESS_ACCOUNT_ID'),

  postCron: process.env.POST_CRON || '0 9 * * *',
  timezone: process.env.TIMEZONE || 'America/New_York',

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
