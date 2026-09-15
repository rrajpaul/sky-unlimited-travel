const Anthropic = require('@anthropic-ai/sdk');
const { config, assertConfigured } = require('../config');

const POST_TYPES = ['travel_quote', 'travel_tip', 'destination_spotlight'];

/**
 * Picks a post type for today. Rotates through types based on the day of
 * year so the feed doesn't feel repetitive, without needing any external
 * state.
 */
function pickPostType(date = new Date()) {
  const dayOfYear = Math.floor(
    (date - new Date(date.getFullYear(), 0, 0)) / 86400000
  );
  return POST_TYPES[dayOfYear % POST_TYPES.length];
}

function buildPrompt(postType) {
  const { name, tagline } = config.brand;

  const shared = `You are writing a single social media post for ${name}, a travel
agency (${tagline}). The post will be shared on Facebook and Instagram.

Respond with ONLY a JSON object, no markdown fences, no preamble, in this
exact shape:
{
  "headline": "short punchy line for the image, under 12 words",
  "caption": "the full social caption, 2-4 sentences, warm and inviting, ending with 2-4 relevant hashtags",
  "image_theme": "one of: beach, mountains, city-skyline, airplane, tropical, roadtrip"
}`;

  const byType = {
    travel_quote: `${shared}\n\nMake the headline an original, inspiring travel quote (not a famous
person's real quote — write your own). Do not attribute it to anyone.`,
    travel_tip: `${shared}\n\nMake the headline a short, genuinely useful travel tip (packing, booking,
airports, or destinations). The caption should expand on the tip briefly.`,
    destination_spotlight: `${shared}\n\nMake the headline name a specific real destination (e.g. a city or region
in the US, Canada, Europe, the Caribbean, or Mexico) with an evocative
adjective. The caption should describe why it's worth visiting.`,
  };

  return byType[postType];
}

async function generatePost({ postType } = {}) {
  assertConfigured(['anthropicApiKey']);
  const type = postType || pickPostType();

  const client = new Anthropic({ apiKey: config.anthropicApiKey });

  const response = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 400,
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

  return { postType: type, ...parsed };
}

module.exports = { generatePost, pickPostType, POST_TYPES };
