# Sky Unlimited Travel — Social Media Manager

A small Express backend that plays the same role as Voyager's "Social Media
Manager": once a day, it generates an AI travel quote/tip/spotlight, renders
it as a branded image, and publishes it to your Facebook Page and linked
Instagram Business account — fully automatically.

## What it does

1. **Generate** — Calls Claude to write post content. Rotates through five
   post types: a travel quote, a travel tip, a destination spotlight, a
   simple illustration-style post, and a checklist/tips infographic.
2. **Render** — Turns that content into a branded square image, using
   whichever style fits the post type:
   - **Quote / tip / spotlight** — either the original branded gradient
     card, or (if you've added photos to `assets/photos/`) one of your own
     photos with the headline overlaid in a legible dark scrim at the
     bottom. When photos are available, there's a 60% chance any given
     quote/tip/spotlight post uses a real photo instead of the gradient —
     see `PHOTO_CARD_PROBABILITY` in `postJob.js` to adjust that.
   - **Illustration** — a simple flat-design scene (palm trees, mountains,
     a city skyline, a plane, a road trip car — matching the AI-picked
     theme) with a short headline.
   - **Checklist** — a titled list of 3–5 tips with checkmark bullets,
     e.g. "5 Tips for Packing Light."
3. **Publish** — Posts the image + caption to your Facebook Page, then to
   your linked Instagram Business account via the Graph API's two-step
   media container flow.
4. **Log** — Every run (success or failure) is appended to `data/history.json`.

Runs once or twice daily on a cron schedule (default: 11:00 AM and 7:00 PM),
plus you can trigger a
post manually or preview one without publishing.

## Adding your own photos

Drop image files (`.jpg`, `.jpeg`, `.png`, or `.webp`) into `assets/photos/`.
No naming convention or manifest needed — the app works through them one at
a time, in alphabetical filename order, and wraps back to the start once it
reaches the end. Progress is saved to `data/photo-cursor.json`, so restarts
(e.g. a Railway redeploy) resume from where they left off rather than
starting over. You can add all ~200 at once, or a few at a time; the library
just needs to be non-empty to start getting used.

Note: ordering is by *filename*, not by when a file was added or its
modification time — file timestamps typically get reset to the same value
during a git-based deploy, making time-based ordering unreliable in
production. If you want photos to post in a specific order, name them so
they sort the way you want alphabetically (e.g. `01-beach.jpg`,
`02-mountains.jpg`).

Check `GET /api/photos` at any time to see how many photos are currently
loaded and their filenames — handy for confirming an upload actually landed
in the right place.

The folder starts empty; until it has at least one photo, quote/tip/
spotlight posts always use the gradient card (the illustration and
checklist post types don't need photos at all, so those work from day one
regardless).

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
| GET    | `/api/photos`   | How many photos are currently loaded in assets/photos, and their filenames |

## Configuring the schedule

Edit `POST_CRON` in `.env` (standard 5-field cron syntax) and `TIMEZONE`.
Default is `0 11 * * *` — 11:00 AM in `America/New_York`, chosen as a
reasonable overlap between Facebook's and Instagram's peak engagement
windows.

Set `POST_CRON_2` to run a **second, independent post** at a different time
each day — e.g. the default `0 19 * * *` (7:00 PM) targets Instagram's
stronger evening peak, complementing `POST_CRON`'s Facebook-friendly morning
slot. Each scheduled time generates its own content and picks its own post
type (quote/tip/spotlight/illustration/checklist) — they're never
duplicates of each other. Leave `POST_CRON_2` blank (`POST_CRON_2=`) to go
back to posting once per day.

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
