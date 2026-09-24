# Monetag setup

This build is wired for Monetag Telegram Mini App rewarded ads using the configured zone ID (default `11878092`).

The app calls `window['show_' + zoneId]()` for the Watch Ads button and also configures the In-App Interstitial with:
- frequency: 2
- capping: 0.1 hours (6 minutes)
- interval: 30 seconds
- timeout: 5 seconds
- everyPage: false

Install the Monetag SDK/ad tag supplied in your Monetag publisher dashboard in `web-index.html`/the site's `<head>` so the `show_<zoneId>` function exists. The project does not invent a Monetag script URL; use the exact tag generated for your Monetag account.

The Admin Panel controls:
- Monetag enabled/disabled
- Zone ID
- GPX reward per completed rewarded ad
- Maximum ads per user per day (default 30)
- Ads required before withdrawal (default 10)
- Tasks required before withdrawal (default 2)
- Withdrawal cooldown in hours

Server-side daily counters enforce the configured limits. Reward is credited only after the rewarded-ad promise resolves in the Mini App.
