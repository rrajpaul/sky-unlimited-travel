const Anthropic = require('@anthropic-ai/sdk');
const { config, assertConfigured } = require('../config');
const { readHistory } = require('./historyStore');

const POST_TYPES = ['travel_quote', 'travel_tip', 'destination_spotlight', 'illustration', 'checklist'];

// How many recent real posts to show the model as "already used, don't
// repeat this topic". Across all post types, not just the one being
// generated — a tip that already appeared as a checklist title is still
// worth steering away from.
//
// Was 15 (~7 days at 2 posts/day), which is why "Book Flights on Tuesday
// Afternoons" still repeated every 10 days: each travel_tip comes up every
// 5 days, so the previous tip on that topic had already fallen out of the
// window. 60 covers about a month, so several earlier posts of every type
// are always visible.
const RECENT_POSTS_FOR_DEDUP = 60;

// How many recent caption openings to show, so captions stop starting the
// same way ("There's a version of you…", "There's magic in…").
const RECENT_OPENERS_FOR_DEDUP = 20;
const OPENER_WORD_COUNT = 6;

/**
 * Returns the most recent REAL (non-dry-run) posts, newest first, as
 * { headline, caption } — shown to the model as topics and openings to
 * avoid repeating. Asked the same open-ended prompt with no memory between
 * calls, the model drifts toward whatever's most common for that kind of
 * request, so it needs to be told what's already been used.
 *
 * Fails open (returns an empty array) rather than throwing if history is
 * unreachable — a history outage should degrade this feature quietly, not
 * block posting entirely.
 */
async function getRecentPosts(limit = RECENT_POSTS_FOR_DEDUP) {
  try {
    const history = await readHistory();
    return history
      .filter((entry) => !entry.dryRun && entry.headline)
      .slice(0, limit)
      .map((entry) => ({ headline: entry.headline, caption: entry.caption || '' }));
  } catch (err) {
    console.error(
      '[contentGenerator] Failed to fetch recent posts for repeat-avoidance (continuing without it):',
      err.message
    );
    return [];
  }
}

/** First few words of a caption, e.g. "There's a version of you that…". */
function captionOpener(caption) {
  const words = caption.trim().split(/\s+/).slice(0, OPENER_WORD_COUNT);
  return words.length ? `${words.join(' ')}…` : '';
}

/**
 * Formats recent posts as a prompt section telling the model not to repeat
 * those topics or caption openings. Returns an empty string if there's
 * nothing to avoid yet (e.g. the very first post ever).
 */
function buildAvoidRepeatsSection(recentPosts) {
  if (!recentPosts || recentPosts.length === 0) return '';

  const headlines = recentPosts.map((p) => `- "${p.headline}"`).join('\n');

  const openers = [
    ...new Set(
      recentPosts
        .slice(0, RECENT_OPENERS_FOR_DEDUP)
        .map((p) => captionOpener(p.caption))
        .filter(Boolean)
    ),
  ];
  const openerSection = openers.length
    ? `\n\nRecent captions opened like this — start yours a different way, with a\ndifferent sentence structure, not just different words:\n${openers.map((o) => `- "${o}"`).join('\n')}`
    : '';

  return `\n\nThese topics/headlines were used in recent posts — write about something\ngenuinely different, not a reworded version of any of these. Covering the\nsame idea with new wording still counts as a repeat:\n${headlines}${openerSection}`;
}

/**
 * Picks a post type for a given day + slot. Rotates through types based on
 * the day of year, offset by slot so multiple posts on the same day get
 * different types.
 */
function pickPostType(date = new Date(), slot = 1) {
  const dayOfYear = Math.floor(
    (date - new Date(date.getFullYear(), 0, 0)) / 86400000
  );
  return POST_TYPES[(dayOfYear + (slot - 1)) % POST_TYPES.length];
}

// Advice that's outdated or widely debunked, and that the model tends to
// reach for by default. Posting it hurts a travel agency's credibility.
const AVOID_MYTHS = `Avoid outdated or debunked travel "hacks", such as booking flights on a
particular weekday (e.g. Tuesday) for lower fares, or clearing cookies /
using incognito mode to get cheaper prices. Only give advice a professional
travel agent would stand behind today.`;

function buildPrompt(postType, recentPosts) {
  const { name, tagline } = config.brand;
  const avoidSection = buildAvoidRepeatsSection(recentPosts);

  const shared = `You are writing a single social media post for ${name}, a travel
agency (${tagline}). The post will be shared on Facebook and Instagram.

Respond with ONLY a JSON object, no markdown fences, no preamble.`;

  const byType = {
    travel_quote: `${shared} Use this exact shape:
{
  "headline": "short punchy line for the image, under 12 words",
  "caption": "the full social caption, 2-4 sentences, warm and inviting, ending with 2-4 relevant hashtags",
  "image_theme": "one of: beach, mountains, city-skyline, airplane, tropical, roadtrip"
}

Make the headline an original, inspiring travel quote (not a famous
person's real quote — write your own). Do not attribute it to anyone.`,

    travel_tip: `${shared} Use this exact shape:
{
  "headline": "short punchy line for the image, under 12 words",
  "caption": "the full social caption, 2-4 sentences, warm and inviting, ending with 2-4 relevant hashtags",
  "image_theme": "one of: beach, mountains, city-skyline, airplane, tropical, roadtrip"
}

Make the headline a short, genuinely useful travel tip. Vary the area it
covers — for example packing, airports and security, travel documents,
health and insurance, money and currency, getting around at the
destination, hotels and resorts, cruises, travelling with kids, or
planning ahead. The caption should expand on the tip briefly.

${AVOID_MYTHS}`,

    destination_spotlight: `${shared} Use this exact shape:
{
  "headline": "short punchy line for the image, under 12 words",
  "caption": "the full social caption, 2-4 sentences, warm and inviting, ending with 2-4 relevant hashtags",
  "image_theme": "one of: beach, mountains, city-skyline, airplane, tropical, roadtrip"
}

Write about the FEELING or EXPERIENCE of a great trip — a "hidden gem"
mood, a moment of wonder, a sense of escape — rather than naming one
specific real city, landmark, or country. Since the accompanying photo is
picked independently and may not literally depict wherever you describe,
avoid headlines like "Discover Santorini" or "Streets of Old Quebec" that
promise a specific place; write something evocative enough to work under
any beautiful travel photo instead, e.g. "Somewhere Worth Getting Lost In"
or "Your Next Great Escape Is Waiting".`,

    illustration: `${shared} Use this exact shape:
{
  "headline": "a short, punchy phrase for a simple illustrated graphic, under 8 words",
  "caption": "the full social caption, 2-4 sentences, warm and inviting, ending with 2-4 relevant hashtags",
  "image_theme": "one of: beach, mountains, city-skyline, airplane, tropical, roadtrip"
}

This will accompany a simple flat-design illustration (not a photo), so keep
the headline light and evocative rather than detailed — something like a
short mood or call-to-action line that fits a minimal graphic.`,

    checklist: `${shared} Use this exact shape:
{
  "headline": "a title for a short checklist/tips graphic, under 8 words, e.g. '5 Tips for Packing Light'",
  "items": ["3 to 5 short, genuinely useful tips, each under 12 words"],
  "caption": "the full social caption, 2-4 sentences, warm and inviting, ending with 2-4 relevant hashtags",
  "image_theme": "one of: beach, mountains, city-skyline, airplane, tropical, roadtrip"
}

Pick ONE clear, specific topic for the checklist (packing for a cruise,
first-time passport tips, what to pack for a beach trip, travelling with
kids, etc.) and write genuinely useful, specific items — not vague
platitudes.

If the headline includes a number, write it as digits and make sure it
exactly matches the number of items in the list.

${AVOID_MYTHS}`,
  };

  return byType[postType] + avoidSection;
}

/**
 * Sends one prompt to Claude and parses the JSON reply. Shared by all the
 * generators below so the parsing and validation behave identically.
 */
async function askForJson({ prompt, maxTokens, label }) {
  const client = new Anthropic({ apiKey: config.anthropicApiKey });

  const response = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }],
  });

  const raw = response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();

  const cleaned = raw.replace(/^```json\s*|```$/g, '').trim();

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(`Failed to parse AI ${label} as JSON: ${err.message}\nRaw: ${raw}`);
  }

  if (!parsed.headline || !parsed.caption) {
    throw new Error(`AI ${label} missing required fields. Got: ${JSON.stringify(parsed)}`);
  }

  return parsed;
}

/**
 * Safety net for checklist headlines: if the headline's number doesn't
 * match the item count (e.g. "6 Must-Haves" with 5 items, as on Oct 5),
 * rewrite the number to match rather than post something visibly wrong.
 */
function fixChecklistCount(headline, itemCount) {
  const match = headline.match(/\b(\d+)\b/);
  if (!match) return headline;
  const stated = Number(match[1]);
  if (stated === itemCount || stated < 2 || stated > 20) return headline;
  console.warn(
    `[contentGenerator] Checklist headline said ${stated} but has ${itemCount} items; correcting.`
  );
  return headline.replace(match[0], String(itemCount));
}

async function generatePost({ postType, slot = 1 } = {}) {
  assertConfigured(['anthropicApiKey']);
  const type = postType || pickPostType(new Date(), slot);
  const recentPosts = await getRecentPosts();

  const parsed = await askForJson({
    prompt: buildPrompt(type, recentPosts),
    maxTokens: 500,
    label: 'content',
  });

  if (type === 'checklist') {
    if (!Array.isArray(parsed.items) || parsed.items.length === 0) {
      throw new Error(`Checklist post missing "items" array. Got: ${JSON.stringify(parsed)}`);
    }
    parsed.headline = fixChecklistCount(parsed.headline, parsed.items.length);
  }

  return { postType: type, ...parsed };
}

/**
 * Generates a giveaway promo post from REAL giveaway data (prize amount,
 * destination, entry URL) — nothing here is invented by the model. The
 * prize amount, destination, and URL are embedded as given facts in the
 * prompt and the model is told explicitly not to alter them.
 */
async function generateGiveawayPost({ giveaway, pageUrl }) {
  assertConfigured(['anthropicApiKey']);
  const { name } = config.brand;

  const destination = giveaway.destinations?.[0] || 'a dream destination';
  const daysLeft = Math.max(
    1,
    Math.ceil((giveaway.end - new Date()) / (1000 * 60 * 60 * 24))
  );

  const prompt = `You are writing a single social media post for ${name}, a travel
agency, promoting a CURRENTLY ACTIVE giveaway. The post will be shared on
Facebook and Instagram.

Real facts about this giveaway — use them EXACTLY as given, do not change,
round, or embellish the numbers or destination:
- Prize: $${giveaway.prizeValueUsd} USD ($${giveaway.prizeValueCad} CAD) travel credit
- Destination: ${destination}
- Entry link: ${pageUrl}
- Roughly ${daysLeft} day(s) left to enter

Respond with ONLY a JSON object, no markdown fences, no preamble, in this
exact shape:
{
  "headline": "short, exciting line for the image, under 10 words, mentioning the destination or prize",
  "caption": "the full social caption, 2-4 sentences, exciting and clear about how to enter (mention the link exactly as given above), ending with 2-4 relevant hashtags",
  "image_theme": "one of: beach, mountains, city-skyline, airplane, tropical, roadtrip — pick whichever best matches the destination"
}`;

  const parsed = await askForJson({ prompt, maxTokens: 500, label: 'giveaway content' });

  return {
    postType: 'giveaway',
    ...parsed,
    prizeValueUsd: giveaway.prizeValueUsd,
    prizeValueCad: giveaway.prizeValueCad,
    destination,
  };
}

/**
 * Generates the headline + caption for a Reel. Same "generic enough to
 * work under any photo" style as the other photo-based post types, since
 * the Reel's photo is picked by plain rotation. Kept short: this sits over
 * a 6-second vertical video, so a shorter headline reads better on screen.
 */
async function generateReelPost() {
  assertConfigured(['anthropicApiKey']);
  const { name, tagline } = config.brand;
  const recentPosts = await getRecentPosts();
  const avoidSection = buildAvoidRepeatsSection(recentPosts);

  const prompt = `You are writing the on-screen text and caption for a short
(6 second) Instagram/Facebook Reel for ${name}, a travel agency (${tagline}).
The Reel is a single travel photo with a slow zoom, no other footage.

Respond with ONLY a JSON object, no markdown fences, no preamble, in this
exact shape:
{
  "headline": "very short, punchy on-screen text, under 8 words — this needs to be readable in a couple of seconds on a small phone screen",
  "caption": "the full social caption, 1-3 sentences, energetic, ending with 3-5 relevant hashtags"
}

Write about the FEELING of travel/escape in general — do not name a
specific real city, landmark, or country, since the photo behind this text
is chosen independently and may not match a specific place you mention.${avoidSection}`;

  const parsed = await askForJson({ prompt, maxTokens: 400, label: 'Reel content' });

  return { postType: 'reel', ...parsed };
}

module.exports = { generatePost, generateGiveawayPost, generateReelPost, pickPostType, POST_TYPES };