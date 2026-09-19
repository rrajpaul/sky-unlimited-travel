const cron = require('node-cron');
const { config } = require('./config');
const { runDailyPost } = require('./services/postJob');

/**
 * Schedules one recurring post job at the given cron expression. `slot`
 * (1 or 2) is passed through to runDailyPost so each scheduled time gets a
 * distinct post type rather than repeating the same style when two posts
 * land on the same day — see pickPostType in contentGenerator.js.
 */
function scheduleOne(cronExpression, label, slot) {
  if (!cron.validate(cronExpression)) {
    throw new Error(`Invalid cron expression for ${label}: "${cronExpression}"`);
  }

  console.log(
    `[scheduler] ${label} scheduled with cron "${cronExpression}" (timezone: ${config.timezone})`
  );

  cron.schedule(
    cronExpression,
    async () => {
      console.log(`[scheduler] Running ${label}...`);
      try {
        const result = await runDailyPost({ dryRun: false, slot });
        console.log(`[scheduler] ${label} complete:`, {
          headline: result.headline,
          errors: result.errors,
        });
      } catch (err) {
        console.error(`[scheduler] ${label} failed:`, err.message);
      }
    },
    { timezone: config.timezone }
  );
}

/**
 * Starts one or two scheduled posts per day. POST_CRON is always active
 * (slot 1). POST_CRON_2 runs a second, independent post at a different time
 * (slot 2) — e.g. one timed for Facebook's morning peak, another for
 * Instagram's evening peak. Each fires as its own fully independent post
 * (its own AI-generated content, its own post type, its own image) — set
 * POST_CRON_2 to an empty string to go back to a single post per day.
 */
function startScheduler() {
  scheduleOne(config.postCron, 'Post #1', 1);

  if (config.postCron2 && config.postCron2.trim() !== '') {
    scheduleOne(config.postCron2, 'Post #2', 2);
  }
}

module.exports = { startScheduler };
