const cron = require('node-cron');
const { config } = require('./config');
const { runDailyPost } = require('./services/postJob');

function startScheduler() {
  if (!cron.validate(config.postCron)) {
    throw new Error(`Invalid POST_CRON expression: "${config.postCron}"`);
  }

  console.log(
    `[scheduler] Daily post scheduled with cron "${config.postCron}" (timezone: ${config.timezone})`
  );

  cron.schedule(
    config.postCron,
    async () => {
      console.log('[scheduler] Running scheduled daily post...');
      try {
        const result = await runDailyPost({ dryRun: false });
        console.log('[scheduler] Post complete:', {
          headline: result.headline,
          errors: result.errors,
        });
      } catch (err) {
        console.error('[scheduler] Daily post failed:', err.message);
      }
    },
    { timezone: config.timezone }
  );
}

module.exports = { startScheduler };
