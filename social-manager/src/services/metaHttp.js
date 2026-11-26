const axios = require('axios');

// ---------------------------------------------------------------------------
// Shared HTTP client + retry rules for every call to Meta (Facebook and
// Instagram Graph API, and rupload.facebook.com for Reel bytes).
// ---------------------------------------------------------------------------

// Without a timeout, axios waits forever on a socket that stops responding,
// so one hung request could stall a scheduled post indefinitely (and the
// ETIMEDOUT retry below would never fire).
const GRAPH_TIMEOUT_MS = 30_000;
// Reel byte uploads push a whole MP4 in one request, so they get longer.
const UPLOAD_TIMEOUT_MS = 5 * 60_000;

const graph = axios.create({ timeout: GRAPH_TIMEOUT_MS });
const upload = axios.create({
  timeout: UPLOAD_TIMEOUT_MS,
  maxBodyLength: Infinity,
  maxContentLength: Infinity,
});

const RETRY_DELAYS_MS = [15_000, 45_000]; // up to 3 attempts total

// Errors that mean the request never reached Meta at all: DNS failed, or
// the TCP/TLS connection couldn't be opened. Safe to retry on ANY step,
// including the ones that actually publish, since Meta never saw them.
const DNS_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN']);

// Errors where the request MAY have reached Meta before the connection
// failed (reset mid-response, timeout waiting for the answer). Retrying is
// only safe on steps where doing the same thing twice is harmless.
const AMBIGUOUS_CODES = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'ECONNABORTED',
  'EPIPE',
  'ECONNREFUSED',
  'ENETUNREACH',
]);

function innerErrors(err) {
  // Node wraps parallel IPv4/IPv6 connect attempts in an AggregateError.
  return [err, ...(Array.isArray(err.errors) ? err.errors : [])].filter(Boolean);
}

/** True if the request certainly never got to Meta. */
function failedBeforeSending(err) {
  if (err.response) return false;
  return innerErrors(err).some(
    (e) => e.syscall === 'connect' || DNS_CODES.has(e.code) || /^getaddrinfo /.test(e.message || '')
  ) || /^connect E[A-Z]+/.test(err.message || '');
}

/** True for any network-level failure (no answer from Meta). */
function isTransientNetworkError(err) {
  if (err.response) return false; // Meta answered: a real rejection, don't retry.
  if (failedBeforeSending(err)) return true;
  if (innerErrors(err).some((e) => AMBIGUOUS_CODES.has(e.code) || DNS_CODES.has(e.code))) return true;
  return /ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up|timeout of \d+ms exceeded/i.test(
    err.message || ''
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs ONE step of a publish flow with retry on network failures.
 *
 *   idempotent: true  — repeating the step is harmless (creating an upload
 *                       session or media container, polling status,
 *                       uploading bytes to the same video_id). Retries on
 *                       any network failure.
 *   idempotent: false — the step makes something public (/photos,
 *                       media_publish, video_reels finish). Retries ONLY if
 *                       the request never reached Meta, so a reset after
 *                       Meta accepted it can't publish a duplicate.
 *
 * Retrying per step (rather than re-running the whole flow) also means a
 * blip while polling doesn't create and publish a second container.
 */
async function step(label, fn, { idempotent }) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const retryable = idempotent ? isTransientNetworkError(err) : failedBeforeSending(err);
      if (attempt >= RETRY_DELAYS_MS.length || !retryable) throw err;
      const delay = RETRY_DELAYS_MS[attempt];
      console.warn(
        `[meta] ${label} network error (${err.message}); retrying in ${delay / 1000}s ` +
          `(attempt ${attempt + 2} of ${RETRY_DELAYS_MS.length + 1})`
      );
      await sleep(delay);
    }
  }
}

module.exports = {
  graph,
  upload,
  step,
  isTransientNetworkError,
  failedBeforeSending,
  RETRY_DELAYS_MS,
  GRAPH_TIMEOUT_MS,
  UPLOAD_TIMEOUT_MS,
};
