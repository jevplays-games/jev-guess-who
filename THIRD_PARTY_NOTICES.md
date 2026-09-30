# Third-party notices

This project has no runtime dependencies. The following third-party assets are
vendored into the repository and redistributed under their own licenses.

## Inter

- License: SIL Open Font License, Version 1.1
- Copyright (c) 2016 The Inter Project Authors
- Vendored at: `public/brand/inter-var.woff2`
- License text: `public/brand/OFL.txt`

## @discord/embedded-app-sdk

- Version: 2.5.0
- License: MIT
- Copyright (c) Discord, Inc.
- Vendored at: `public/vendor/discord-embedded-app-sdk.js` (a pre-built bundle, so the page's `script-src 'self'` policy holds)
- Loaded only when Discord launches the game as an Activity; see `docs/ACTIVITY.md`.
