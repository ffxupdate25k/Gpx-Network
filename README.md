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
