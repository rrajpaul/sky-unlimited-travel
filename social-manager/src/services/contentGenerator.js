const Anthropic = require('@anthropic-ai/sdk');
const { config, assertConfigured } = require('../config');

const POST_TYPES = ['travel_quote', 'travel_tip', 'destination_spotlight', 'illustration', 'checklist'];

/**
 * Picks a post type for a given day + slot. Rotates through types based on
 * the day of year, offset by slot so multiple posts on the same day get
 * different types instead of all repeating the same style — e.g. slot 1
 * might land on "checklist" while slot 2 lands on "travel_tip", rather than
 * both being "checklist" just because they ran on the same date.
 */
function pickPostType(date = new Date(), slot = 1) {
  const dayOfYear = Math.floor(
    (date - new Date(date.getFullYear(), 0, 0)) / 86400000
  );
  return POST_TYPES[(dayOfYear + (slot - 1)) % POST_TYPES.length];
}

function buildPrompt(postType) {
  const { name, tagline } = config.brand;

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

Make the headline a short, genuinely useful travel tip (packing, booking,
airports, or destinations). The caption should expand on the tip briefly.`,

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
booking flights on a budget, first-time passport tips, what to pack for a
beach trip, etc.) and write genuinely useful, specific items — not vague
platitudes.`,
  };

  return byType[postType];
}

async function generatePost({ postType, slot = 1 } = {}) {
  assertConfigured(['anthropicApiKey']);
  const type = postType || pickPostType(new Date(), slot);

  const client = new Anthropic({ apiKey: config.anthropicApiKey });

  const response = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 500,
    messages: [{ role: 'user', content: buildPrompt(type) }],
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
    throw new Error(`Failed to parse AI content as JSON: ${err.message}\nRaw: ${raw}`);
  }

  if (!parsed.headline || !parsed.caption) {
    throw new Error(`AI content missing required fields. Got: ${JSON.stringify(parsed)}`);
  }

  if (type === 'checklist' && (!Array.isArray(parsed.items) || parsed.items.length === 0)) {
    throw new Error(`Checklist post missing "items" array. Got: ${JSON.stringify(parsed)}`);
  }

  return { postType: type, ...parsed };
}

/**
 * Generates a giveaway promo post from REAL giveaway data (prize amount,
 * destination, entry URL) — unlike the five regular post types, nothing
 * here is invented by the model. The prize amount, destination, and URL are
 * embedded as given facts in the prompt and the model is told explicitly
 * not to alter them, since getting these wrong in a real promotion is a
 * much bigger problem than a slightly awkward caption.
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

  const client = new Anthropic({ apiKey: config.anthropicApiKey });
  const response = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 500,
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
    throw new Error(`Failed to parse AI giveaway content as JSON: ${err.message}\nRaw: ${raw}`);
  }

  if (!parsed.headline || !parsed.caption) {
    throw new Error(`AI giveaway content missing required fields. Got: ${JSON.stringify(parsed)}`);
  }

  return {
    postType: 'giveaway',
    ...parsed,
    prizeValueUsd: giveaway.prizeValueUsd,
    prizeValueCad: giveaway.prizeValueCad,
    destination,
  };
}

module.exports = { generatePost, generateGiveawayPost, pickPostType, POST_TYPES };