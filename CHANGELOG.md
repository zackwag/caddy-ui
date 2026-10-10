# Changelog

## [2.13.1](https://github.com/zackwag/caddy-ui/compare/v2.13.0...v2.13.1) (2026-10-10)


### Bug Fixes

* keep Caddyfile history when the default instance is replaced ([#175](https://github.com/zackwag/caddy-ui/issues/175)) ([bb2129a](https://github.com/zackwag/caddy-ui/commit/bb2129a78ce3a0e5daa850a22a151cacc3da5f58))

## [2.13.0](https://github.com/zackwag/caddy-ui/compare/v2.12.1...v2.13.0) (2026-10-10)


### Features

* show a diff of Caddyfile snapshots in version history ([#173](https://github.com/zackwag/caddy-ui/issues/173)) ([902b275](https://github.com/zackwag/caddy-ui/commit/902b27583a46949a1927336a97aa04771f00003a))

## [2.12.1](https://github.com/zackwag/caddy-ui/compare/v2.12.0...v2.12.1) (2026-10-10)


### Bug Fixes

* serve favicon from an absolute path and add SVG/touch icons ([#170](https://github.com/zackwag/caddy-ui/issues/170)) ([f1c0b18](https://github.com/zackwag/caddy-ui/commit/f1c0b186f09cde9405d2496bd88382edeff47ad7))

## [2.12.0](https://github.com/zackwag/caddy-ui/compare/v2.11.3...v2.12.0) (2026-10-10)


### Features

* add route maintenance mode toggle ([#156](https://github.com/zackwag/caddy-ui/issues/156)) ([7da83be](https://github.com/zackwag/caddy-ui/commit/7da83bea995e38f6eb7a0ff316e6aa8711502c74))

## [2.11.3](https://github.com/zackwag/caddy-ui/compare/v2.11.2...v2.11.3) (2026-10-10)


### Bug Fixes

* bundle the caddy binary again for local mode ([#161](https://github.com/zackwag/caddy-ui/issues/161)) ([3918218](https://github.com/zackwag/caddy-ui/commit/39182181027bb250402b21d27b6499227f3ad37f))

## [2.11.2](https://github.com/zackwag/caddy-ui/compare/v2.11.1...v2.11.2) (2026-10-10)


### Bug Fixes

* say why the TLS certs path couldn't be read ([#162](https://github.com/zackwag/caddy-ui/issues/162)) ([7631d77](https://github.com/zackwag/caddy-ui/commit/7631d777a9ed35850789889cfc9d338c3d0d8392))

## [2.11.1](https://github.com/zackwag/caddy-ui/compare/v2.11.0...v2.11.1) (2026-10-10)


### Bug Fixes

* stop reporting implicitly managed TLS certs as orphaned ([#160](https://github.com/zackwag/caddy-ui/issues/160)) ([6b59ca4](https://github.com/zackwag/caddy-ui/commit/6b59ca41edaea02ad549af895cdb6a66bc3d5245))

## [2.11.0](https://github.com/zackwag/caddy-ui/compare/v2.10.0...v2.11.0) (2026-10-09)


### Features

* add favicon matching the UI branding ([#157](https://github.com/zackwag/caddy-ui/issues/157)) ([c1c5ea2](https://github.com/zackwag/caddy-ui/commit/c1c5ea26961b83c809cc7fc6d3b09c33e2740e0e))

## [2.10.0](https://github.com/zackwag/caddy-ui/compare/v2.9.0...v2.10.0) (2026-10-07)


### Features

* notify when a route goes down or recovers ([#141](https://github.com/zackwag/caddy-ui/issues/141)) ([ab76ad6](https://github.com/zackwag/caddy-ui/commit/ab76ad6547aa3cf3db1fe73dc1d06df97de51f14))

## [2.9.0](https://github.com/zackwag/caddy-ui/compare/v2.8.0...v2.9.0) (2026-10-07)


### Features

* use route check results on the Routes page ([#140](https://github.com/zackwag/caddy-ui/issues/140)) ([7555573](https://github.com/zackwag/caddy-ui/commit/75555736990baf628ebb4c1a26ad9a918c352f22))

## [2.8.0](https://github.com/zackwag/caddy-ui/compare/v2.7.0...v2.8.0) (2026-10-06)


### Features

* export route check uptime in Prometheus metrics ([#139](https://github.com/zackwag/caddy-ui/issues/139)) ([c273880](https://github.com/zackwag/caddy-ui/commit/c2738808e04eb90d501787921255206af36b8cab))


### Bug Fixes

* use the shared upstream check for the status endpoint's upstream count ([#138](https://github.com/zackwag/caddy-ui/issues/138)) ([f6f53ad](https://github.com/zackwag/caddy-ui/commit/f6f53ad5fb39b06b7c2061692cfa9a52f425051d))

## [2.7.0](https://github.com/zackwag/caddy-ui/compare/v2.6.3...v2.7.0) (2026-10-05)


### Features

* optional route checks for end-to-end uptime ([#132](https://github.com/zackwag/caddy-ui/issues/132)) ([48952c4](https://github.com/zackwag/caddy-ui/commit/48952c4a19642ffa9ddbfdcb11384ae1c41e6d46))


### Bug Fixes

* say "routes" in the Routes Online card when route checks are on ([#136](https://github.com/zackwag/caddy-ui/issues/136)) ([99b6d09](https://github.com/zackwag/caddy-ui/commit/99b6d094e1584cb4fe00d3b9261810e7fcec2415))

## [2.6.3](https://github.com/zackwag/caddy-ui/compare/v2.6.2...v2.6.3) (2026-10-05)


### Bug Fixes

* keep last good metrics when a refresh fails ([#128](https://github.com/zackwag/caddy-ui/issues/128)) ([167c40d](https://github.com/zackwag/caddy-ui/commit/167c40dc894b4591d2b31a82846cb588a7b99ac9))
* record shared upstreams once per check and drop admin URL trailing slash ([#133](https://github.com/zackwag/caddy-ui/issues/133)) ([d5377eb](https://github.com/zackwag/caddy-ui/commit/d5377eb452dc77c5ad4fbc2e2e1321e2b53a3bcb))

## [2.6.2](https://github.com/zackwag/caddy-ui/compare/v2.6.1...v2.6.2) (2026-10-05)


### Bug Fixes

* detect offline upstreams without passive health checks ([#130](https://github.com/zackwag/caddy-ui/issues/130)) ([9357b14](https://github.com/zackwag/caddy-ui/commit/9357b1467daf8e5ade83815df4346db643457643))

## [2.6.1](https://github.com/zackwag/caddy-ui/compare/v2.6.0...v2.6.1) (2026-10-05)


### Bug Fixes

* stop Metrics page redrawing on auto refresh ([#127](https://github.com/zackwag/caddy-ui/issues/127)) ([d2fa409](https://github.com/zackwag/caddy-ui/commit/d2fa40905bf078c3a7aa942398ed3cd6131623c4))

## [2.6.0](https://github.com/zackwag/caddy-ui/compare/v2.5.0...v2.6.0) (2026-10-05)


### Features

* expose upstream uptime in Prometheus metrics and the Metrics page ([7a6b0cd](https://github.com/zackwag/caddy-ui/commit/7a6b0cdda342c92c687667a963ba53ccc165c1b5))
* upstream uptime in Prometheus metrics and Metrics page ([#122](https://github.com/zackwag/caddy-ui/issues/122)) ([7a6b0cd](https://github.com/zackwag/caddy-ui/commit/7a6b0cdda342c92c687667a963ba53ccc165c1b5))

## [2.5.0](https://github.com/zackwag/caddy-ui/compare/v2.4.1...v2.5.0) (2026-10-05)


### Features

* route status history modal ([#90](https://github.com/zackwag/caddy-ui/issues/90)) ([3943adf](https://github.com/zackwag/caddy-ui/commit/3943adf1b207c2eda90419b37c149f554f289865))

## [2.4.1](https://github.com/zackwag/caddy-ui/compare/v2.4.0...v2.4.1) (2026-10-04)


### Bug Fixes

* Update Dockerfile to node:24-alpine ([#123](https://github.com/zackwag/caddy-ui/issues/123)) ([fd1d5ee](https://github.com/zackwag/caddy-ui/commit/fd1d5ee215268abd39a52c7c607a6c4d57015812))

## [2.4.0](https://github.com/zackwag/caddy-ui/compare/v2.3.1...v2.4.0) (2026-09-29)


### Features

* record upstream checks continuously, independent of the dashboard ([#112](https://github.com/zackwag/caddy-ui/issues/112)) ([77b3273](https://github.com/zackwag/caddy-ui/commit/77b32731ab68c4886d148e5ebf6dd9ad7695070d))

## [2.3.1](https://github.com/zackwag/caddy-ui/compare/v2.3.0...v2.3.1) (2026-09-28)


### Bug Fixes

* derive hardcoded colors from theme variables app-wide ([#105](https://github.com/zackwag/caddy-ui/issues/105)) ([b0772b8](https://github.com/zackwag/caddy-ui/commit/b0772b8d0e995d139343df28b1f731ec3f4b4c95))

## [2.3.0](https://github.com/zackwag/caddy-ui/compare/v2.2.2...v2.3.0) (2026-09-28)


### Features

* support custom themes via THEMES_PATH folder scan ([#103](https://github.com/zackwag/caddy-ui/issues/103)) ([f74f073](https://github.com/zackwag/caddy-ui/commit/f74f07307248786f226a38c81ed6e008ec407065))

## [2.2.2](https://github.com/zackwag/caddy-ui/compare/v2.2.1...v2.2.2) (2026-09-27)


### Bug Fixes

* declare color-scheme so browser dark-mode extensions back off ([#101](https://github.com/zackwag/caddy-ui/issues/101)) ([2a20007](https://github.com/zackwag/caddy-ui/commit/2a200074688432a844c90a40c820a9751107743c))

## [2.2.1](https://github.com/zackwag/caddy-ui/compare/v2.2.0...v2.2.1) (2026-09-27)


### Bug Fixes

* prevent empty scrollable space below content on short pages ([#98](https://github.com/zackwag/caddy-ui/issues/98)) ([2e41c76](https://github.com/zackwag/caddy-ui/commit/2e41c762d4503633d554c410df0965b6e017375f))

## [2.2.0](https://github.com/zackwag/caddy-ui/compare/v2.1.0...v2.2.0) (2026-09-27)


### Features

* theme picker with 26 palettes, server-side settings, and first-run welcome ([#96](https://github.com/zackwag/caddy-ui/issues/96)) ([30bfc8a](https://github.com/zackwag/caddy-ui/commit/30bfc8ac971e0fb41f2850541c39efa768463748))

## [2.1.0](https://github.com/zackwag/caddy-ui/compare/v2.0.0...v2.1.0) (2026-09-27)


### Features

* persist per-instance uptime history with configurable retention ([#93](https://github.com/zackwag/caddy-ui/issues/93)) ([2455e68](https://github.com/zackwag/caddy-ui/commit/2455e683ee25fc8d3f41577cf70d0d570148a985))

## [2.0.0](https://github.com/zackwag/caddy-ui/compare/v1.23.0...v2.0.0) (2026-09-27)


### ⚠ BREAKING CHANGES

* add multi-Caddy instance support ([#73](https://github.com/zackwag/caddy-ui/issues/73))

### Features

* add multi-Caddy instance support ([#73](https://github.com/zackwag/caddy-ui/issues/73)) ([5a99b7b](https://github.com/zackwag/caddy-ui/commit/5a99b7bd6383014af43296103c55edc344a71b9b))

## [1.23.0](https://github.com/zackwag/caddy-ui/compare/v1.22.0...v1.23.0) (2026-09-26)


### Features

* add :edge Docker tag built on every push to main ([#89](https://github.com/zackwag/caddy-ui/issues/89)) ([779b828](https://github.com/zackwag/caddy-ui/commit/779b828fa8557390c3c08dae889a802b69688184))


### Bug Fixes

* add ref input to beta workflow ([#75](https://github.com/zackwag/caddy-ui/issues/75)) ([56fd55c](https://github.com/zackwag/caddy-ui/commit/56fd55c2f0cfbe5e2bb1662f72be47e0e4872b9d))
* clarify misleading "new installation" log reason ([#88](https://github.com/zackwag/caddy-ui/issues/88)) ([b09df85](https://github.com/zackwag/caddy-ui/commit/b09df855d8f65aed1f37f3fe9065a91de4be46b7))
* use short SHA for beta version string ([41e66e8](https://github.com/zackwag/caddy-ui/commit/41e66e8786ed18bbe1ace5855028f9562bd09619))
* use short SHA for beta version string ([#77](https://github.com/zackwag/caddy-ui/issues/77)) ([cc5ab3b](https://github.com/zackwag/caddy-ui/commit/cc5ab3bbd7678176669fcb78e04006d7b478d04a))

## [1.22.0](https://github.com/zackwag/caddy-ui/compare/v1.21.2...v1.22.0) (2026-09-20)


### Features

* add sortable Title column to route table ([#71](https://github.com/zackwag/caddy-ui/issues/71)) ([8116634](https://github.com/zackwag/caddy-ui/commit/81166345ed72363e700a7e176ac6ef70978f46f9))

## [1.21.2](https://github.com/zackwag/caddy-ui/compare/v1.21.1...v1.21.2) (2026-09-20)


### Bug Fixes

* resolve Caddyfile env vars when matching site blocks ([#69](https://github.com/zackwag/caddy-ui/issues/69)) ([4c60d88](https://github.com/zackwag/caddy-ui/commit/4c60d88ebcf76c9b83c17d2186dd21eee81bc0cd))

## [1.21.1](https://github.com/zackwag/caddy-ui/compare/v1.21.0...v1.21.1) (2026-09-20)


### Bug Fixes

* set trust proxy for rate limiter behind Caddy ([#66](https://github.com/zackwag/caddy-ui/issues/66)) ([05225f6](https://github.com/zackwag/caddy-ui/commit/05225f61a9728c8f56f664978878de9d403f7d7c))

## [1.21.0](https://github.com/zackwag/caddy-ui/compare/v1.20.1...v1.21.0) (2026-09-20)


### Features

* inline caddyfile editor in edit modal with title comments ([#62](https://github.com/zackwag/caddy-ui/issues/62)) ([4763183](https://github.com/zackwag/caddy-ui/commit/4763183da8240a3ad3782061dd6aa0462f8fe5f6))


### Bug Fixes

* add API rate limiting ([#63](https://github.com/zackwag/caddy-ui/issues/63)) ([52a8383](https://github.com/zackwag/caddy-ui/commit/52a8383f3df49bfd787aeeb81e808e02225696a7))

## [1.20.1](https://github.com/zackwag/caddy-ui/compare/v1.20.0...v1.20.1) (2026-09-20)


### Bug Fixes

* mobile view fixes across the app ([#60](https://github.com/zackwag/caddy-ui/issues/60)) ([11dff29](https://github.com/zackwag/caddy-ui/commit/11dff295772e3d4cb8b9872d7a8cfba51031ae82))

## [1.20.0](https://github.com/zackwag/caddy-ui/compare/v1.19.0...v1.20.0) (2026-09-19)


### Features

* **ci:** detect caddyfile-codemirror vocabulary updates automatically ([#58](https://github.com/zackwag/caddy-ui/issues/58)) ([1665e70](https://github.com/zackwag/caddy-ui/commit/1665e703ff76eb5e085f83a57889d0a5def5fb36))

## [1.19.0](https://github.com/zackwag/caddy-ui/compare/v1.18.1...v1.19.0) (2026-09-18)


### Features

* add ESLint for backend and frontend ([#56](https://github.com/zackwag/caddy-ui/issues/56)) ([3d2b5f9](https://github.com/zackwag/caddy-ui/commit/3d2b5f90d304571982092861d170332ff6468cf0))

## [1.18.1](https://github.com/zackwag/caddy-ui/compare/v1.18.0...v1.18.1) (2026-09-17)


### Bug Fixes

* **ci:** use RELEASE_PLEASE_TOKEN so releases trigger downstream workflows ([#53](https://github.com/zackwag/caddy-ui/issues/53)) ([62d6e4a](https://github.com/zackwag/caddy-ui/commit/62d6e4aea4eeb25d2308f3137465f68e7740873d))

## [1.18.0](https://github.com/zackwag/caddy-ui/compare/v1.17.0...v1.18.0) (2026-09-17)


### Features

* **ci:** adopt release-please ([#51](https://github.com/zackwag/caddy-ui/issues/51)) ([c2d81c7](https://github.com/zackwag/caddy-ui/commit/c2d81c7c6d15803fab86e0b61b8b4eea66a5f667))
