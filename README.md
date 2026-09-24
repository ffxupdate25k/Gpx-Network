# GPX Network Telegram Mini App

Deploy on Render (Web Service, Node). Build command: `npm install`. Start command: `npm start`.

## Environment variables (Render > Environment)
| Name | Value |
|------|-------|
| BOT_TOKEN | token from @BotFather |
| DATABASE_URL | your Postgres connection string |
| PUBLIC_URL | your Render URL, e.g. https://your-app.onrender.com |
| ADMIN_IDS | Telegram user IDs allowed to use the admin panel, comma separated, e.g. `7995243814,123456789` |

Every ID in ADMIN_IDS always sees the Admin Panel card on the dashboard. After changing ADMIN_IDS, redeploy, then close and reopen the Mini App.


## Monetag rewarded ads
This build includes server-enforced daily ad limits and withdrawal requirements.
In **Admin Panel → Settings → Monetag Rewards** configure:
- Monetag zone ID (pre-filled with `11878092`)
- Monetag SDK script URL from your Monetag Publisher dashboard
- GPX reward per completed ad
- maximum ads per user per day
- required ads and tasks before withdrawal
- withdrawal cooldown in hours

The app only credits the ad reward after the Monetag `show_<zone>()` Promise resolves. The server also enforces the daily cap and one-time short-lived ad claim token.

The automatic In-App Interstitial is configured for a maximum of 2 impressions per session window with a 30-second interval, as requested.

Monetag's official TMA documentation says the publisher dashboard generates the exact SDK `<script src="..." data-zone="..." data-sdk="show_...">` tag; use that exact script URL rather than guessing it.
