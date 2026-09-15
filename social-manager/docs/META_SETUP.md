# Meta (Facebook + Instagram) Setup

How to get the values required in `.env`: `FB_PAGE_ID`, `FB_PAGE_ACCESS_TOKEN`,
and `IG_BUSINESS_ACCOUNT_ID`. Instagram publishing reuses `FB_PAGE_ACCESS_TOKEN`
(Meta unifies auth through the linked Facebook Page), so there's no separate
Instagram token.

## Prerequisites

- You must be an **admin** of the Sky Unlimited Travel Facebook Page.
- The Instagram account must be a **Business or Creator** account, and it must
  be **linked** to the Facebook Page (Page Settings → Linked Accounts →
  Instagram, or in the Instagram app: Settings → Account → Linked Accounts →
  Facebook).

## 1. Create a Facebook Developer App

1. Go to `developers.facebook.com/apps` → **Create App**.
2. Choose type **Business**.
3. Name it (e.g. "Sky Unlimited Travel Social Manager").
4. Note the **App ID** and **App Secret** under **Settings → Basic** — needed
   in step 3.

## 2. Get a short-lived User Access Token with the right permissions

1. In the app dashboard, go to **Tools → Graph API Explorer**.
2. Select your app, and select your **Facebook User** as the token type.
3. Click **Permissions** and add:
   - `pages_manage_posts`
   - `pages_read_engagement`
   - `pages_show_list`
   - `instagram_basic`
   - `instagram_content_publish`
4. Click **Generate Access Token** and approve the permissions. This is a
   short-lived user token (~1 hour) — just a stepping stone to the long-lived
   Page token below.

## 3. Get the Page ID and exchange for a long-lived Page token

1. Exchange the short-lived user token for a long-lived one (~60 days):

   ```
   GET https://graph.facebook.com/v21.0/oauth/access_token?
     grant_type=fb_exchange_token&
     client_id={app-id}&
     client_secret={app-secret}&
     fb_exchange_token={short-lived-user-token}
   ```

2. Call `GET /me/accounts` using that long-lived user token. The response
   lists the Pages you manage, each with:
   - `id` → this is `FB_PAGE_ID`
   - `access_token` → a **long-lived Page token** (unlike user tokens, this
     does not expire as long as the granting user stays a Page admin) →
     this is `FB_PAGE_ACCESS_TOKEN`

## 4. Get the Instagram Business Account ID

With the long-lived Page token:

```
GET https://graph.facebook.com/v21.0/{FB_PAGE_ID}?fields=instagram_business_account&access_token={FB_PAGE_ACCESS_TOKEN}
```

The response's `instagram_business_account.id` is `IG_BUSINESS_ACCOUNT_ID`.

## 5. Fill in `.env`

```
FB_PAGE_ID=<id from step 3>
FB_PAGE_ACCESS_TOKEN=<long-lived token from step 3>
IG_BUSINESS_ACCOUNT_ID=<id from step 4>
```

## Verify

1. `POST /api/preview` — generates content + image without publishing.
2. `POST /api/post-now` — publishes once, live.
3. `GET /api/history?limit=5` — confirm the Graph API calls succeeded.

## Things to watch

- **Token expiry**: long-lived Page tokens can still be invalidated (password
  change, permission revocation, app review changes). Periodically re-run
  step 3's exchange, or set a calendar reminder.
- **Development Mode**: while the app is in Development Mode, these
  permissions only work for accounts with a role on the app (admins/devs/
  testers) — fine for managing your own Page, but adding other Pages later
  would require Meta App Review.
