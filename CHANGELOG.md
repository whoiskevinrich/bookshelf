# Changelog

## [0.7.1](https://github.com/whoiskevinrich/bookshelf/compare/v0.7.0...v0.7.1) (2026-07-24)


### Bug Fixes

* **api:** rate-limit OCR text-scan endpoint (BOOKSHELF-99) ([#128](https://github.com/whoiskevinrich/bookshelf/issues/128)) ([e297e10](https://github.com/whoiskevinrich/bookshelf/commit/e297e1073ce4a6b45fcf73efc44fba13694e11a6))
* **deps:** patch fast-uri, brace-expansion, body-parser via pnpm overrides ([#133](https://github.com/whoiskevinrich/bookshelf/issues/133)) ([1daa45b](https://github.com/whoiskevinrich/bookshelf/commit/1daa45b22e4525529a6d138881fe76ed79e42853))
* **web:** keep shelf status pills on one row on narrow viewports ([#129](https://github.com/whoiskevinrich/bookshelf/issues/129)) ([059a097](https://github.com/whoiskevinrich/bookshelf/commit/059a09740e174db80b040925208d5cd4925f140e))

## [0.7.0](https://github.com/whoiskevinrich/bookshelf/compare/v0.6.0...v0.7.0) (2026-07-13)


### Features

* **web:** seed What's New feed with recent releases (BOOKSHELF-76) ([#127](https://github.com/whoiskevinrich/bookshelf/issues/127)) ([13144f1](https://github.com/whoiskevinrich/bookshelf/commit/13144f1a9106835d5c06bd747390acb0f3f3f5da))


### Bug Fixes

* v1 tech-debt batch A (BOOKSHELF-6, -10, -24, -25, -26) ([#125](https://github.com/whoiskevinrich/bookshelf/issues/125)) ([aedb0ee](https://github.com/whoiskevinrich/bookshelf/commit/aedb0ee31eebc98c8fa19ce6582036a2c5d9a10f))

## [0.6.0](https://github.com/whoiskevinrich/bookshelf/compare/v0.5.1...v0.6.0) (2026-07-12)


### Features

* Manage Library bulk-select mode (BOOKSHELF-59) ([#122](https://github.com/whoiskevinrich/bookshelf/issues/122)) ([9285117](https://github.com/whoiskevinrich/bookshelf/commit/928511742da4dd6553e2735fd251f7ae33bc8f41))


### Bug Fixes

* **books:** retry transient Google Books errors (BOOKSHELF-95) ([#124](https://github.com/whoiskevinrich/bookshelf/issues/124)) ([c10b8d7](https://github.com/whoiskevinrich/bookshelf/commit/c10b8d707d93a4ac5a087231a569e2428093097b))

## [0.5.1](https://github.com/whoiskevinrich/bookshelf/compare/v0.5.0...v0.5.1) (2026-07-12)


### Bug Fixes

* **e2e:** repair E2E pipeline - stale Wishlist assertions, missing remove-confirm click, ISBN fallback bug (BOOKSHELF-94) ([#120](https://github.com/whoiskevinrich/bookshelf/issues/120)) ([3a34142](https://github.com/whoiskevinrich/bookshelf/commit/3a34142840acebffab79b803e40f8346af549fc5))

## [0.5.0](https://github.com/whoiskevinrich/bookshelf/compare/v0.4.0...v0.5.0) (2026-07-12)


### Features

* edition grouping — relate multiple editions of one work (BOOKSHELF-90, BOOKSHELF-91, BOOKSHELF-92, BOOKSHELF-93) ([#119](https://github.com/whoiskevinrich/bookshelf/issues/119)) ([6d0be11](https://github.com/whoiskevinrich/bookshelf/commit/6d0be112aab561916353708056fad387bb707d81))
* **shelf:** multiple copies of the same book (BOOKSHELF-60) ([#115](https://github.com/whoiskevinrich/bookshelf/issues/115)) ([043c26d](https://github.com/whoiskevinrich/bookshelf/commit/043c26daea8110f604bf11629a3e1478f60d4007))


### Bug Fixes

* **deps:** bump transitive hono to patched 4.12.27 (BOOKSHELF-43) ([#116](https://github.com/whoiskevinrich/bookshelf/issues/116)) ([d08517f](https://github.com/whoiskevinrich/bookshelf/commit/d08517f8bc9adfc67bcfa4e72f1cb8e5e70b465d))

## [0.4.0](https://github.com/whoiskevinrich/bookshelf/compare/v0.3.0...v0.4.0) (2026-07-09)


### Features

* **web:** library author filter, derived client-side (BOOKSHELF-57) ([#112](https://github.com/whoiskevinrich/bookshelf/issues/112)) ([c626114](https://github.com/whoiskevinrich/bookshelf/commit/c62611471ed05b0a4b2b02f843e792889f56d464))
* **web:** library sort — date added, title, author, release (BOOKSHELF-57) ([#111](https://github.com/whoiskevinrich/bookshelf/issues/111)) ([02d8e8d](https://github.com/whoiskevinrich/bookshelf/commit/02d8e8d196f1e5ce46487b4ca171e9f7fb486af7))
* **web:** scanner remembers a shelf destination, not just status (BOOKSHELF-85) ([#109](https://github.com/whoiskevinrich/bookshelf/issues/109)) ([95beb99](https://github.com/whoiskevinrich/bookshelf/commit/95beb9973a065970b4c8a3542a7241068b1f92fc))

## [0.3.0](https://github.com/whoiskevinrich/bookshelf/compare/v0.2.1...v0.3.0) (2026-07-05)


### Features

* **ci:** belt-and-suspenders formatting gate (BOOKSHELF-83) ([#105](https://github.com/whoiskevinrich/bookshelf/issues/105)) ([0850f5b](https://github.com/whoiskevinrich/bookshelf/commit/0850f5b0909f958908bc22aa5b6fdc7d62f8de1d))
* **ci:** mid-pipeline Jira status sync — On Dev + QA gate (BOOKSHELF-77) ([#106](https://github.com/whoiskevinrich/bookshelf/issues/106)) ([6b2fddf](https://github.com/whoiskevinrich/bookshelf/commit/6b2fddf779e44b17cb5e24c927f69d16e44dee50))
* coordinate release-please releases with Jira (BOOKSHELF-70) ([#96](https://github.com/whoiskevinrich/bookshelf/issues/96)) ([36c3272](https://github.com/whoiskevinrich/bookshelf/commit/36c327203ab7d6b29c9941a61fc3909246d3d5af))
* **web:** scanner remembers last destination (BOOKSHELF-58) ([#104](https://github.com/whoiskevinrich/bookshelf/issues/104)) ([3641822](https://github.com/whoiskevinrich/bookshelf/commit/3641822e7657557b3af5123f0b9b726cd6f0f8b3))
* **web:** search box over your own library (BOOKSHELF-52) ([#98](https://github.com/whoiskevinrich/bookshelf/issues/98)) ([e188a00](https://github.com/whoiskevinrich/bookshelf/commit/e188a004a0b17f878677cc7c7a0fbcf35b8bec0b))
* **web:** URL-synced shelf filters + reading-list view (BOOKSHELF-69) ([#92](https://github.com/whoiskevinrich/bookshelf/issues/92)) ([5fea76f](https://github.com/whoiskevinrich/bookshelf/commit/5fea76f993e01b8dee3ab4f743714ab5de3ea863))
* **web:** What's New panel with unseen dot (BOOKSHELF-75) ([#103](https://github.com/whoiskevinrich/bookshelf/issues/103)) ([245e323](https://github.com/whoiskevinrich/bookshelf/commit/245e323d36c5d00449a3090cdd5a9090fc944ae5))
* **web:** whats-new.json generator from Release-Note trailers (BOOKSHELF-74) ([#102](https://github.com/whoiskevinrich/bookshelf/issues/102)) ([404c230](https://github.com/whoiskevinrich/bookshelf/commit/404c2303e4a58ba2028c0b28bd1b9763ecae1d50))
* **web:** Wishlist rename + Wishlist/Reading-list nav links (BOOKSHELF-53, BOOKSHELF-54) ([#94](https://github.com/whoiskevinrich/bookshelf/issues/94)) ([54381be](https://github.com/whoiskevinrich/bookshelf/commit/54381be0dd4b008726af67cb70d00edc34fa3fcd))


### Bug Fixes

* **ci:** resolve Google Books key from SSM in E2E, emit HTML report (BOOKSHELF-4) ([#100](https://github.com/whoiskevinrich/bookshelf/issues/100)) ([fbf3efb](https://github.com/whoiskevinrich/bookshelf/commit/fbf3efbe67d3aa1695618d9ce4d0ba2aa719c06d))
* **web:** mobile ergonomics - safe-area, touch floor, type scale (BOOKSHELF-56) ([#99](https://github.com/whoiskevinrich/bookshelf/issues/99)) ([3d72475](https://github.com/whoiskevinrich/bookshelf/commit/3d72475218f9f68247929bf575068011cb370550))
* **web:** recover ISBN-13 from barcodes with an EAN-2/EAN-5 add-on (BOOKSHELF-50) ([#97](https://github.com/whoiskevinrich/bookshelf/issues/97)) ([10ada42](https://github.com/whoiskevinrich/bookshelf/commit/10ada421f926c3cb73f0a114c088fc837141f831))

## [0.2.1](https://github.com/whoiskevinrich/bookshelf/compare/v0.2.0...v0.2.1) (2026-07-02)


### Bug Fixes

* **ci:** drop package-name so release-please can tag its merged release PR ([#90](https://github.com/whoiskevinrich/bookshelf/issues/90)) ([3ff87ba](https://github.com/whoiskevinrich/bookshelf/commit/3ff87ba64b2e2e1e5b56727d720d4331c87af527))

## [0.2.0](https://github.com/whoiskevinrich/bookshelf/compare/v0.1.57...v0.2.0) (2026-07-02)

### Features

- **ci:** Release Please dev→prod promotion gate (ADR-020) ([#85](https://github.com/whoiskevinrich/bookshelf/issues/85)) ([5b60d92](https://github.com/whoiskevinrich/bookshelf/commit/5b60d92a99276ca1fb67dbd3165655685b2ca379))
- **web:** soften light theme to warm paper palette (BOOKSHELF-55) ([#88](https://github.com/whoiskevinrich/bookshelf/issues/88)) ([084d9ba](https://github.com/whoiskevinrich/bookshelf/commit/084d9badad28ed4c52f423f7e33c1245bcfe01e9))

### Bug Fixes

- **web:** scan add via Enter, duplicate 409 messages, safe card delete ([#87](https://github.com/whoiskevinrich/bookshelf/issues/87)) ([20ddf91](https://github.com/whoiskevinrich/bookshelf/commit/20ddf91bd9191fe2b80ad7a1097fc0a10aba21d1))
