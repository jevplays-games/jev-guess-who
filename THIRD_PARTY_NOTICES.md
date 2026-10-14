# Third-party notices

This project has no runtime dependencies. The following third-party assets are
vendored into the repository and redistributed under their own licenses.

## Inter

- License: SIL Open Font License, Version 1.1
- Copyright (c) 2016 The Inter Project Authors
- Vendored at: `public/brand/inter-var.woff2`
- Modified: subset to Latin-1 plus common punctuation and arrows, with the optical-size axis
  pinned at its default (the weight axis is kept, 100-900) so the page stays inside the
  150,000-byte gzip asset budget. Made with fontTools `varLib.instancer` and `pyftsubset`.
- License text: `public/brand/OFL.txt`

## VT323

- License: SIL Open Font License, Version 1.1
- Copyright 2011 The VT323 Project Authors
- Vendored at: `public/brand/vt323.woff2`
- License text: `public/brand/OFL-VT323.txt`

## @discord/embedded-app-sdk

- Version: 2.5.0
- License: MIT
- Copyright (c) Discord, Inc.
- Vendored at: `public/vendor/discord-embedded-app-sdk.js` (a pre-built bundle, so the page's `script-src 'self'` policy holds)
- Loaded only when Discord launches the game as an Activity; see `docs/ACTIVITY.md`.
