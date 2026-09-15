# Sky Unlimited Travel — Social Media Manager

A small Express backend that plays the same role as Voyager's "Social Media
Manager": once a day, it generates an AI travel quote/tip/spotlight, renders
it as a branded image, and publishes it to your Facebook Page and linked
Instagram Business account — fully automatically.

## What it does

1. **Generate** — Calls Claude to write a short headline + caption (rotates
   daily between a travel quote, a travel tip, and a destination spotlight).
2. **Render** — Draws that headline onto a branded 1080x1080 gradient card
   (no external image APIs or stock photo licensing needed).
3. **Publish** — Posts the image + caption to your Facebook Page, then to
   your linked Instagram Business account via the Graph API's two-step
   media container flow.
4. **Log** — Every run (success or failure) is appended to `data/history.json`.

Runs once daily on a cron schedule (default 9:00 AM), plus you can trigger a
post manually or preview one without publishing.

## Requirements before this can actually post

Meta's Graph API requires:

- A **Facebook Page** for Sky Unlimited Travel.
- A **Facebook Developer App** (developers.facebook.com) with the Page
  connected, and a **long-lived Page Access Token** with
  `pages_manage_posts` + `pages_read_engagement` permissions.
- An **Instagram Business or Creator account**, linked to that Facebook
  Page, to get its `IG_BUSINESS_ACCOUNT_ID`.
- A server this app runs on that is **publicly reachable over HTTPS**
  (`PUBLIC_BASE_URL`) — Meta's servers fetch the generated image by URL, so
  `localhost` will not work for real posting. In local development, a tool
  like `ngrok` pointed at your dev server works fine for testing.
- An **Anthropic API key** for content generation.

None of this is optional — Graph API calls will fail without valid,
correctly-scoped tokens, and Meta's app review process may apply if you
move beyond your own linked assets.

See [`docs/META_SETUP.md`](docs/META_SETUP.md) for a step-by-step walkthrough
of obtaining the Facebook Page ID, long-lived Page access token, and
Instagram Business Account ID.

## Setup

```bash
cd sky-social-manager
npm install
cp .env.example .env
# then fill in .env with your real tokens/IDs
npm start
```

## Endpoints

| Method | Path            | Purpose                                                          |
|--------|-----------------|-------------------------------------------------------------------|
| GET    | `/api/health`   | Liveness check                                                    |
| POST   | `/api/preview`  | Generate content + image, but do NOT post — good for a sanity check |
| POST   | `/api/post-now` | Generate and immediately publish to Facebook + Instagram          |
| GET    | `/api/history?limit=30` | Recent post history (including any errors)                |

## Configuring the schedule

Edit `POST_CRON` in `.env` (standard 5-field cron syntax) and `TIMEZONE`.
Default is `0 9 * * *` — once daily at 9:00 AM in `America/New_York`.

## Notes / things to decide before going live

- **Review before it's fully hands-off**: right now `/api/preview` lets you
  see a day's post before the schedule fires, but the scheduled job itself
  posts with no human approval step, matching "once daily, automatic." If
  you'd rather have a human approve each post first, the scheduler can be
  changed to call `/api/preview`-style generation and queue it for approval
  instead of publishing directly — happy to add that if you want it.
- **Duplicate/rate-limit protection**: this doesn't currently check whether
  today's post already ran (e.g. after a server restart). For production,
  consider adding a check against `history.json` for "already posted today"
  before the cron job proceeds.
- **Image style**: images are a solid-gradient quote/tip card rather than
  real destination photography. If you want real photos behind the text
  (e.g. via a stock photo API), that's a straightforward addition to
  `imageGenerator.js`.
- **Token expiry**: Page access tokens can expire; you may want to set a
  reminder to refresh `FB_PAGE_ACCESS_TOKEN` periodically, or implement
  Meta's token refresh flow.
