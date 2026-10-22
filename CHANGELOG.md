# Changelog

## [3.6.10](https://github.com/zackwag/caddy-ui/compare/v3.6.9...v3.6.10) (2026-10-22)


### Bug Fixes

* support comma-separated origins in CADDY_UI_EXTERNAL_URL ([#419](https://github.com/zackwag/caddy-ui/issues/419)) ([d356427](https://github.com/zackwag/caddy-ui/commit/d3564277728ab975fdf87435e574a435d7d98ce7))

## [3.6.9](https://github.com/zackwag/caddy-ui/compare/v3.6.8...v3.6.9) (2026-10-22)


### Bug Fixes

* serve maintenance pages from a backend endpoint instead of inlining HTML ([#417](https://github.com/zackwag/caddy-ui/issues/417)) ([ea94f3c](https://github.com/zackwag/caddy-ui/commit/ea94f3c214bf1d6739d7f983bfdcc908201996d0))

## [3.6.8](https://github.com/zackwag/caddy-ui/compare/v3.6.7...v3.6.8) (2026-10-22)


### Bug Fixes

* correct healthcheck endpoints for both images ([#420](https://github.com/zackwag/caddy-ui/issues/420)) ([4d75e57](https://github.com/zackwag/caddy-ui/commit/4d75e576b5093bdddaa9f4c984cc8e32c90c7642))

## [3.6.7](https://github.com/zackwag/caddy-ui/compare/v3.6.6...v3.6.7) (2026-10-22)


### Bug Fixes

* explicit backend healthcheck through IPv4 ([#414](https://github.com/zackwag/caddy-ui/issues/414)) ([61b534e](https://github.com/zackwag/caddy-ui/commit/61b534e1da8ce4c1ae4c9e0b4888cf47e2984d0a))

## [3.6.6](https://github.com/zackwag/caddy-ui/compare/v3.6.5...v3.6.6) (2026-10-21)


### Bug Fixes

* add Docker healthchecks to backend and frontend images ([#410](https://github.com/zackwag/caddy-ui/issues/410)) ([21b14ab](https://github.com/zackwag/caddy-ui/commit/21b14abbbe253c2d109b00f34b0d09f8203aeafc))

## [3.6.5](https://github.com/zackwag/caddy-ui/compare/v3.6.4...v3.6.5) (2026-10-21)


### Bug Fixes

* use the Caddyfile scanner for site blocks, sorting and titles ([#405](https://github.com/zackwag/caddy-ui/issues/405)) ([8e6cb17](https://github.com/zackwag/caddy-ui/commit/8e6cb172d9d4ca4d83c30fa2c267800a8a5a3057))

## [3.6.4](https://github.com/zackwag/caddy-ui/compare/v3.6.3...v3.6.4) (2026-10-21)


### Bug Fixes

* harden logging configuration validation and preserve file style ([#406](https://github.com/zackwag/caddy-ui/issues/406)) ([0e41570](https://github.com/zackwag/caddy-ui/commit/0e41570b62c83f450a97e739ddac6a1550dc85a7))

## [3.6.3](https://github.com/zackwag/caddy-ui/compare/v3.6.2...v3.6.3) (2026-10-21)


### Bug Fixes

* distinguish unavailable Caddy logs from empty files ([#400](https://github.com/zackwag/caddy-ui/issues/400)) ([5a6abae](https://github.com/zackwag/caddy-ui/commit/5a6abaedc01c715ec47ca92316fc0ff7c52cefa5))

## [3.6.2](https://github.com/zackwag/caddy-ui/compare/v3.6.1...v3.6.2) (2026-10-21)


### Bug Fixes

* respect Caddyfile syntax when reading and updating logging ([#398](https://github.com/zackwag/caddy-ui/issues/398)) ([9b45336](https://github.com/zackwag/caddy-ui/commit/9b453366a3e747f8b47cd4f7f31421febae3fe18))

## [3.6.1](https://github.com/zackwag/caddy-ui/compare/v3.6.0...v3.6.1) (2026-10-21)


### Miscellaneous Chores

* **deps:** bump i18next from 26.4.4 to 26.5.2 in /src/frontend ([#395](https://github.com/zackwag/caddy-ui/issues/395)) ([e3ef92c](https://github.com/zackwag/caddy-ui/commit/e3ef92c95b6a82eccdaa3b7b28c77100e931c673))
* **deps:** bump ipaddr.js from 1.9.1 to 2.5.0 in /src/backend ([#390](https://github.com/zackwag/caddy-ui/issues/390)) ([6d826d1](https://github.com/zackwag/caddy-ui/commit/6d826d17563c8184ccf23aa6e25c6e2d26d62876))
* **deps:** bump react from 19.3.0 to 19.3.1 in /src/frontend ([#384](https://github.com/zackwag/caddy-ui/issues/384)) ([573d660](https://github.com/zackwag/caddy-ui/commit/573d660f10ede3057043ace5942d9d73644b73e2))
* **deps:** bump react-i18next from 17.0.16 to 17.1.0 in /src/frontend ([#392](https://github.com/zackwag/caddy-ui/issues/392)) ([e69e530](https://github.com/zackwag/caddy-ui/commit/e69e530338cd8eab05e34832e2166d32af257141))

## [3.6.0](https://github.com/zackwag/caddy-ui/compare/v3.5.0...v3.6.0) (2026-10-20)


### Features

* attribute saved Caddyfile versions to authenticated identities ([#373](https://github.com/zackwag/caddy-ui/issues/373)) ([57caad0](https://github.com/zackwag/caddy-ui/commit/57caad0a043e3c75cb6886034a8d883d6b56ecc3))

## [3.5.0](https://github.com/zackwag/caddy-ui/compare/v3.4.0...v3.5.0) (2026-10-20)


### Features

* add authentication event notifications ([#372](https://github.com/zackwag/caddy-ui/issues/372)) ([73d4e0f](https://github.com/zackwag/caddy-ui/commit/73d4e0fbfea688cf90d5d759e3d021b30b007457))

## [3.4.0](https://github.com/zackwag/caddy-ui/compare/v3.3.0...v3.4.0) (2026-10-20)


### Features

* add HTTPS passkey sign-in and management ([#363](https://github.com/zackwag/caddy-ui/issues/363)) ([ac8ece3](https://github.com/zackwag/caddy-ui/commit/ac8ece3cf5407d088e70910ba1159e9858c36804))
* derive default route titles from hostnames ([#371](https://github.com/zackwag/caddy-ui/issues/371)) ([5f0d7c3](https://github.com/zackwag/caddy-ui/commit/5f0d7c3443a4d3824c503e053ca980d0ba98d12f))
* preserve client rate limits through trusted proxies ([#356](https://github.com/zackwag/caddy-ui/issues/356)) ([645df19](https://github.com/zackwag/caddy-ui/commit/645df19b4d6def91aeec5885d84261f1692dfaff))

## [3.3.0](https://github.com/zackwag/caddy-ui/compare/v3.2.1...v3.3.0) (2026-10-19)


### Features

* add security settings and administrator credential updates ([#362](https://github.com/zackwag/caddy-ui/issues/362)) ([5a13b7f](https://github.com/zackwag/caddy-ui/commit/5a13b7fab74f8b6fce9c55b22eb45245ca2a0a51))

## [3.2.1](https://github.com/zackwag/caddy-ui/compare/v3.2.0...v3.2.1) (2026-10-19)


### Bug Fixes

* poll for stopped Caddy status in capture script ([#366](https://github.com/zackwag/caddy-ui/issues/366)) ([a709179](https://github.com/zackwag/caddy-ui/commit/a70917922290005351a566c175eb9370040e8e56))

## [3.2.0](https://github.com/zackwag/caddy-ui/compare/v3.1.3...v3.2.0) (2026-10-19)


### Features

* retry failed upstream notifications ([#351](https://github.com/zackwag/caddy-ui/issues/351)) ([23ea7c8](https://github.com/zackwag/caddy-ui/commit/23ea7c8732e761ab802f591d39c9cf2e8c7603d6))


### Bug Fixes

* increase capture polling intervals to avoid rate limiting ([#364](https://github.com/zackwag/caddy-ui/issues/364)) ([1deef42](https://github.com/zackwag/caddy-ui/commit/1deef428b939d60c7183cb646d07dc8946d2b1a1))

## [3.1.3](https://github.com/zackwag/caddy-ui/compare/v3.1.2...v3.1.3) (2026-10-19)


### Bug Fixes

* avoid CodeQL parse error in playground HMR cleanup ([#350](https://github.com/zackwag/caddy-ui/issues/350)) ([ae6dad2](https://github.com/zackwag/caddy-ui/commit/ae6dad27f7a0803abb94e5f0e319da361ced9303))
* poll for empty server count in capture script ([#360](https://github.com/zackwag/caddy-ui/issues/360)) ([ba4eaec](https://github.com/zackwag/caddy-ui/commit/ba4eaec6852d7d76e9db16830ab283c5debaa099))
* poll for orphaned certificate status in capture script ([#358](https://github.com/zackwag/caddy-ui/issues/358)) ([04949eb](https://github.com/zackwag/caddy-ui/commit/04949eb404ca477fa95da41770479f6ca5c46cb3))

## [3.1.2](https://github.com/zackwag/caddy-ui/compare/v3.1.1...v3.1.2) (2026-10-19)


### Bug Fixes

* isolate notification categories so one failure does not skip the rest ([#349](https://github.com/zackwag/caddy-ui/issues/349)) ([f6bf709](https://github.com/zackwag/caddy-ui/commit/f6bf7093e10d181813231ab6a61bdd82383d1128))

## [3.1.1](https://github.com/zackwag/caddy-ui/compare/v3.1.0...v3.1.1) (2026-10-19)


### Bug Fixes

* reject navigations to /api/auth/csrf to prevent session replacement ([#353](https://github.com/zackwag/caddy-ui/issues/353)) ([2a347e9](https://github.com/zackwag/caddy-ui/commit/2a347e9c3b2ec4491e431cc018da0bb152843f92)), closes [#286](https://github.com/zackwag/caddy-ui/issues/286)

## [3.1.0](https://github.com/zackwag/caddy-ui/compare/v3.0.2...v3.1.0) (2026-10-19)


### Features

* add opt-in es-ES translations ([#341](https://github.com/zackwag/caddy-ui/issues/341)) ([8e489de](https://github.com/zackwag/caddy-ui/commit/8e489de4f84bfcc38a04324005835213173752c0))
* default API token requests to the token's only instance ([#338](https://github.com/zackwag/caddy-ui/issues/338)) ([284e0f4](https://github.com/zackwag/caddy-ui/commit/284e0f4ff4a86892d037827f63652b886141ba3b)), closes [#337](https://github.com/zackwag/caddy-ui/issues/337)
* notify before API tokens expire ([#336](https://github.com/zackwag/caddy-ui/issues/336)) ([d4396c2](https://github.com/zackwag/caddy-ui/commit/d4396c2368d6c4779e5a0c1457f6a128fe4e4a47)), closes [#335](https://github.com/zackwag/caddy-ui/issues/335)


### Code Refactoring

* share configuration reads and upstream checks across requests and monitors ([#334](https://github.com/zackwag/caddy-ui/issues/334)) ([912f6a0](https://github.com/zackwag/caddy-ui/commit/912f6a022625396b4b82fe15313718e362d81e79)), closes [#307](https://github.com/zackwag/caddy-ui/issues/307)

## [3.0.2](https://github.com/zackwag/caddy-ui/compare/v3.0.1...v3.0.2) (2026-10-19)


### Bug Fixes

* complete reviewed German translations ([#339](https://github.com/zackwag/caddy-ui/issues/339)) ([c4b0e32](https://github.com/zackwag/caddy-ui/commit/c4b0e32a59917d84e769721cc83254bc1cfd4ee5))

## [3.0.1](https://github.com/zackwag/caddy-ui/compare/v3.0.0...v3.0.1) (2026-10-18)


### Bug Fixes

* keep route notes per instance and notification settings instance-free ([#325](https://github.com/zackwag/caddy-ui/issues/325)) ([afb0e49](https://github.com/zackwag/caddy-ui/commit/afb0e492417f8214fbe13d8fcbc56506f737e847))

## [3.0.0](https://github.com/zackwag/caddy-ui/compare/v2.29.7...v3.0.0) (2026-10-18)


### ⚠ BREAKING CHANGES

* harden authentication flow ([#311](https://github.com/zackwag/caddy-ui/issues/311))

### Bug Fixes

* authed api ([#316](https://github.com/zackwag/caddy-ui/issues/316)) ([78f87fe](https://github.com/zackwag/caddy-ui/commit/78f87fe1c89cd91bb18b7c5686a5724552817f9a))
* harden authentication flow ([#311](https://github.com/zackwag/caddy-ui/issues/311)) ([dcb1b51](https://github.com/zackwag/caddy-ui/commit/dcb1b513bea501ec79fb2346af4cb180bfea6d1a))
* treat a missing Caddy data directory as no certificates ([#327](https://github.com/zackwag/caddy-ui/issues/327)) ([b9e0da9](https://github.com/zackwag/caddy-ui/commit/b9e0da98c3b792deb390092b3d17f402029d4238))

## [2.29.7](https://github.com/zackwag/caddy-ui/compare/v2.29.6...v2.29.7) (2026-10-18)


### Bug Fixes

* give every Caddyfile change the same save, reload and rollback guarantees ([#324](https://github.com/zackwag/caddy-ui/issues/324)) ([8be5c20](https://github.com/zackwag/caddy-ui/commit/8be5c20dfa66ab4984e5bea1eb8adc80a6fdd48c))

## [2.29.6](https://github.com/zackwag/caddy-ui/compare/v2.29.5...v2.29.6) (2026-10-18)


### Bug Fixes

* link edge and beta update badges to the commits since the running build ([#322](https://github.com/zackwag/caddy-ui/issues/322)) ([41559a7](https://github.com/zackwag/caddy-ui/commit/41559a755a9abd884402743f4c37696d7f23f3e2))

## [2.29.5](https://github.com/zackwag/caddy-ui/compare/v2.29.4...v2.29.5) (2026-10-18)


### Bug Fixes

* distinguish empty routes and certificates from unavailable data ([#318](https://github.com/zackwag/caddy-ui/issues/318)) ([ac2d4a5](https://github.com/zackwag/caddy-ui/commit/ac2d4a5db18efde82a2eb61c29e97f0e160078c3))
* stop treating unreadable notes, history and cert storage as empty ([#319](https://github.com/zackwag/caddy-ui/issues/319)) ([f04d1aa](https://github.com/zackwag/caddy-ui/commit/f04d1aaec15b9c93d3a5113d744243ad90cce2a7))

## [2.29.4](https://github.com/zackwag/caddy-ui/compare/v2.29.3...v2.29.4) (2026-10-18)


### Bug Fixes

* isolate maintenance state and restoration per Caddy instance ([#315](https://github.com/zackwag/caddy-ui/issues/315)) ([4d30670](https://github.com/zackwag/caddy-ui/commit/4d306709fd687b003f682a3771bcd993808743ea))

## [2.29.3](https://github.com/zackwag/caddy-ui/compare/v2.29.2...v2.29.3) (2026-10-18)


### Bug Fixes

* reject explicitly unknown Caddy instance selections ([#312](https://github.com/zackwag/caddy-ui/issues/312)) ([798abec](https://github.com/zackwag/caddy-ui/commit/798abecea86458461e6fee1ebd6849bf32a08581))
* stop health reads from adding uptime history samples ([#313](https://github.com/zackwag/caddy-ui/issues/313)) ([f3a03fc](https://github.com/zackwag/caddy-ui/commit/f3a03fca9dfb4d089a207a785057c81ebd16d7c5))

## [2.29.2](https://github.com/zackwag/caddy-ui/compare/v2.29.1...v2.29.2) (2026-10-16)


### Bug Fixes

* improve Routes discoverability and prevent action-button wrapping ([#297](https://github.com/zackwag/caddy-ui/issues/297)) ([d16b759](https://github.com/zackwag/caddy-ui/commit/d16b759ddf8d6a988653d7a484919a1d0182ed13))

## [2.29.1](https://github.com/zackwag/caddy-ui/compare/v2.29.0...v2.29.1) (2026-10-16)


### Bug Fixes

* refuse startup when authentication is partially configured ([#292](https://github.com/zackwag/caddy-ui/issues/292)) ([d8a3d1f](https://github.com/zackwag/caddy-ui/commit/d8a3d1f1ec9d046bfa5d24f524cdc801130b0dca))
* show instance names beside dashboard server IDs ([#295](https://github.com/zackwag/caddy-ui/issues/295)) ([e324b36](https://github.com/zackwag/caddy-ui/commit/e324b364ba06374f93ab218a7b9e4fbbcfedc68a))

## [2.29.0](https://github.com/zackwag/caddy-ui/compare/v2.28.0...v2.29.0) (2026-10-16)


### Features

* add german translation ([#296](https://github.com/zackwag/caddy-ui/issues/296)) ([13b9ddd](https://github.com/zackwag/caddy-ui/commit/13b9ddd0fa93735cc85b6d0c599058c391a567e4))
* **dev:** expand localization playground coverage to 285 keys ([#293](https://github.com/zackwag/caddy-ui/issues/293)) ([5e6f4a0](https://github.com/zackwag/caddy-ui/commit/5e6f4a0c76b19597c52b5a7562284cdcbe2315c1))

## [2.28.0](https://github.com/zackwag/caddy-ui/compare/v2.27.2...v2.28.0) (2026-10-16)


### Features

* allow private-network notification destinations ([#272](https://github.com/zackwag/caddy-ui/issues/272)) ([d33d894](https://github.com/zackwag/caddy-ui/commit/d33d894a3a058dbf2e9d2eaf8ee0964f2af8859f))


### Bug Fixes

* reject cross-site writes and drop permissive CORS ([#275](https://github.com/zackwag/caddy-ui/issues/275)) ([fa1a72a](https://github.com/zackwag/caddy-ui/commit/fa1a72a935fdaee7fe8dc9e0dd03338521978f21))

## [2.27.2](https://github.com/zackwag/caddy-ui/compare/v2.27.1...v2.27.2) (2026-10-16)


### Performance Improvements

* compress and cache frontend assets in nginx ([#284](https://github.com/zackwag/caddy-ui/issues/284)) ([b10d174](https://github.com/zackwag/caddy-ui/commit/b10d1743069e9551d4c69dd1ead20d9769434b26))

## [2.27.1](https://github.com/zackwag/caddy-ui/compare/v2.27.0...v2.27.1) (2026-10-16)


### Miscellaneous Chores

* **deps:** bump i18next from 26.4.3 to 26.4.4 in /src/frontend ([#281](https://github.com/zackwag/caddy-ui/issues/281)) ([b8f6bc4](https://github.com/zackwag/caddy-ui/commit/b8f6bc4f4cf8d507e33198971d2847263b207abe))
* move playground tests to dev/ ([#283](https://github.com/zackwag/caddy-ui/issues/283)) ([a977e7d](https://github.com/zackwag/caddy-ui/commit/a977e7d2926c5824bb3b49faedd39dc6261535db))
* reorganize application packages and development tooling ([#264](https://github.com/zackwag/caddy-ui/issues/264)) ([1bee573](https://github.com/zackwag/caddy-ui/commit/1bee573333a166b5de1ac4dcbc05df48b837be15))

## [2.27.0](https://github.com/zackwag/caddy-ui/compare/v2.26.1...v2.27.0) (2026-10-16)


### Features

* **i18n:** add Spanish (Mexico) locale skeleton and support region subtags ([#273](https://github.com/zackwag/caddy-ui/issues/273)) ([324d14f](https://github.com/zackwag/caddy-ui/commit/324d14fbe2b685185132b7352548d88bdd153629))

## [2.26.1](https://github.com/zackwag/caddy-ui/compare/v2.26.0...v2.26.1) (2026-10-16)


### Bug Fixes

* **docs:** update screenshot fixture for new /languages response shape ([#270](https://github.com/zackwag/caddy-ui/issues/270)) ([2c3d4f9](https://github.com/zackwag/caddy-ui/commit/2c3d4f99888d6c3032cfae90a4c456183733b82c))

## [2.26.0](https://github.com/zackwag/caddy-ui/compare/v2.25.3...v2.26.0) (2026-10-16)


### Features

* **i18n:** Enable reviewed languages and opt-in Arabic fonts ([#250](https://github.com/zackwag/caddy-ui/issues/250)) ([587aa9f](https://github.com/zackwag/caddy-ui/commit/587aa9f812f10562c528b7f3ec7dcb22711eeb58))

## [2.25.3](https://github.com/zackwag/caddy-ui/compare/v2.25.2...v2.25.3) (2026-10-16)


### Bug Fixes

* keep language picker label from overflowing ([#267](https://github.com/zackwag/caddy-ui/issues/267)) ([2f6a706](https://github.com/zackwag/caddy-ui/commit/2f6a70671167d9b6adbf40ae69445948acb6a8f7))

## [2.25.2](https://github.com/zackwag/caddy-ui/compare/v2.25.1...v2.25.2) (2026-10-16)


### Bug Fixes

* replace font-dependent UI symbols with custom SVG icons ([#259](https://github.com/zackwag/caddy-ui/issues/259)) ([0db2e49](https://github.com/zackwag/caddy-ui/commit/0db2e490c33568b8f0cfd0b4866648f31ae92fc1))

## [2.25.1](https://github.com/zackwag/caddy-ui/compare/v2.25.0...v2.25.1) (2026-10-16)


### Bug Fixes

* **e2e:** prevent navigation and Docker network startup races ([#255](https://github.com/zackwag/caddy-ui/issues/255)) ([fcbd909](https://github.com/zackwag/caddy-ui/commit/fcbd90999c884bcf250082800ee266ada860433f))

## [2.25.0](https://github.com/zackwag/caddy-ui/compare/v2.24.0...v2.25.0) (2026-10-15)


### Features

* **docs:** generate screenshots with Playwright during docs build ([#251](https://github.com/zackwag/caddy-ui/issues/251)) ([4b64049](https://github.com/zackwag/caddy-ui/commit/4b64049cae873a6d208335631121123c13a9ac72))

## [2.24.0](https://github.com/zackwag/caddy-ui/compare/v2.23.0...v2.24.0) (2026-10-15)


### Features

* **dev:** expand localization playground coverage ([#252](https://github.com/zackwag/caddy-ui/issues/252)) ([01e9e9a](https://github.com/zackwag/caddy-ui/commit/01e9e9a5b817d8617b7785b1868a4ef8966cd5b0))

## [2.23.0](https://github.com/zackwag/caddy-ui/compare/v2.22.0...v2.23.0) (2026-10-15)


### Features

* **i18n:** add reviewed Arabic catalog and RTL interface ([#247](https://github.com/zackwag/caddy-ui/issues/247)) ([8ce3300](https://github.com/zackwag/caddy-ui/commit/8ce3300e0e1e4b5c220641897d2280a272ced8f8))

## [2.22.0](https://github.com/zackwag/caddy-ui/compare/v2.21.6...v2.22.0) (2026-10-15)


### Features

* **dev:** add a localization playground with real component previews ([#229](https://github.com/zackwag/caddy-ui/issues/229)) ([03bc106](https://github.com/zackwag/caddy-ui/commit/03bc1063f57ae5e432811e787228e3abf4fac8e5))

## [2.21.6](https://github.com/zackwag/caddy-ui/compare/v2.21.5...v2.21.6) (2026-10-14)


### Reverts

* remove redundant #closed flag from FixtureScope ([#234](https://github.com/zackwag/caddy-ui/issues/234)) ([bbbc119](https://github.com/zackwag/caddy-ui/commit/bbbc11904efd7dd7d9e0dbc3f1be80ef6b45a34a))

## [2.21.5](https://github.com/zackwag/caddy-ui/compare/v2.21.4...v2.21.5) (2026-10-14)


### Bug Fixes

* harden error handling in API client, instances, and error registry ([#231](https://github.com/zackwag/caddy-ui/issues/231)) ([d5ce4f9](https://github.com/zackwag/caddy-ui/commit/d5ce4f9765e5b23094ff25578696362f37f86a36))

## [2.21.4](https://github.com/zackwag/caddy-ui/compare/v2.21.3...v2.21.4) (2026-10-13)


### Bug Fixes

* localize error feedback and centralize notification policies ([#222](https://github.com/zackwag/caddy-ui/issues/222)) ([8f26738](https://github.com/zackwag/caddy-ui/commit/8f26738335e6b6ea28acf76cd013c3d0e8e554b4))

## [2.21.3](https://github.com/zackwag/caddy-ui/compare/v2.21.2...v2.21.3) (2026-10-13)


### Bug Fixes

* centralize backend error contracts and diagnostics ([#221](https://github.com/zackwag/caddy-ui/issues/221)) ([07af6c3](https://github.com/zackwag/caddy-ui/commit/07af6c35ed605f5f5f30c66970ca509d4dc0b951))

## [2.21.2](https://github.com/zackwag/caddy-ui/compare/v2.21.1...v2.21.2) (2026-10-13)


### Reverts

* restore Caddy instance URL behavior ([4d07537](https://github.com/zackwag/caddy-ui/commit/4d07537c747922b2e7fc6f0d5f91a4a74456e3d7))
* restore Caddy instance URL behavior pending security review ([#219](https://github.com/zackwag/caddy-ui/issues/219)) ([4d07537](https://github.com/zackwag/caddy-ui/commit/4d07537c747922b2e7fc6f0d5f91a4a74456e3d7))

## [2.21.1](https://github.com/zackwag/caddy-ui/compare/v2.21.0...v2.21.1) (2026-10-13)


### Bug Fixes

* restrict Caddy admin requests and harden documentation tooling ([#216](https://github.com/zackwag/caddy-ui/issues/216)) ([a4074db](https://github.com/zackwag/caddy-ui/commit/a4074db6e79580538bc3067791eaadbdaea2648d))

## [2.21.0](https://github.com/zackwag/caddy-ui/compare/v2.20.2...v2.21.0) (2026-10-13)


### Features

* add localization foundation ([#202](https://github.com/zackwag/caddy-ui/issues/202)) ([3afc5f0](https://github.com/zackwag/caddy-ui/commit/3afc5f0e1b335f56a711c818341d46ec4b4f4ce0))

## [2.20.2](https://github.com/zackwag/caddy-ui/compare/v2.20.1...v2.20.2) (2026-10-13)


### Bug Fixes

* report stopped Caddy instances as offline ([#213](https://github.com/zackwag/caddy-ui/issues/213)) ([05674e3](https://github.com/zackwag/caddy-ui/commit/05674e3a85616a5641be4daf64a879191134add6))


### Miscellaneous Chores

* **dev:** add disposable Caddy integration environment ([#208](https://github.com/zackwag/caddy-ui/issues/208)) ([fa90d95](https://github.com/zackwag/caddy-ui/commit/fa90d953e3426cc835f30aebfc663f4ef923d824))

## [2.20.1](https://github.com/zackwag/caddy-ui/compare/v2.20.0...v2.20.1) (2026-10-12)


### Bug Fixes

* improve Caddyfile editor layout, version history UX and faulty `dev` version ([#210](https://github.com/zackwag/caddy-ui/issues/210)) ([4f565fe](https://github.com/zackwag/caddy-ui/commit/4f565fe5c653e74b2c16fa0e2432f413c9ef7139))

## [2.20.0](https://github.com/zackwag/caddy-ui/compare/v2.19.0...v2.20.0) (2026-10-12)


### Features

* add caddy-ui application logs ([#201](https://github.com/zackwag/caddy-ui/issues/201)) ([c8248af](https://github.com/zackwag/caddy-ui/commit/c8248afdd316199a79dd749366345e93eb370a97))

## [2.19.0](https://github.com/zackwag/caddy-ui/compare/v2.18.0...v2.19.0) (2026-10-11)


### Features

* restructure the Dashboard's servers card around labels and Server IDs ([#193](https://github.com/zackwag/caddy-ui/issues/193)) ([65c79b8](https://github.com/zackwag/caddy-ui/commit/65c79b8d6c2f65ec1e7daf78447dbc2e50eaa25b))

## [2.18.0](https://github.com/zackwag/caddy-ui/compare/v2.17.4...v2.18.0) (2026-10-11)


### Features

* send a notification when a new caddy/ui release is available ([#191](https://github.com/zackwag/caddy-ui/issues/191)) ([5ff9615](https://github.com/zackwag/caddy-ui/commit/5ff9615540053808bc1fcfa5812d61fe89000a22))

## [2.17.4](https://github.com/zackwag/caddy-ui/compare/v2.17.3...v2.17.4) (2026-10-11)


### Bug Fixes

* don't prefix edge, beta, and dev builds with "v" in the sidebar ([#190](https://github.com/zackwag/caddy-ui/issues/190)) ([3e89485](https://github.com/zackwag/caddy-ui/commit/3e894858e28e42f8f19789e8539b189c7c4d7a57))

## [2.17.3](https://github.com/zackwag/caddy-ui/compare/v2.17.2...v2.17.3) (2026-10-11)


### Bug Fixes

* keep server labels per instance ([#189](https://github.com/zackwag/caddy-ui/issues/189)) ([c120722](https://github.com/zackwag/caddy-ui/commit/c1207222a42e32a104dfb237c623053531d6ce35))

## [2.17.2](https://github.com/zackwag/caddy-ui/compare/v2.17.1...v2.17.2) (2026-10-11)


### Bug Fixes

* refuse to add routes to a server ID that Caddy doesn't have ([#188](https://github.com/zackwag/caddy-ui/issues/188)) ([a61ef60](https://github.com/zackwag/caddy-ui/commit/a61ef602b4813a4dc1e12b3702a2ae7fc53d3d46))

## [2.17.1](https://github.com/zackwag/caddy-ui/compare/v2.17.0...v2.17.1) (2026-10-11)


### Bug Fixes

* roll back route edits that Caddy rejects ([#187](https://github.com/zackwag/caddy-ui/issues/187)) ([059bb4b](https://github.com/zackwag/caddy-ui/commit/059bb4b5644643a02c605bb299fd400890d75fdc))

## [2.17.0](https://github.com/zackwag/caddy-ui/compare/v2.16.0...v2.17.0) (2026-10-11)


### Features

* show an update badge when a newer caddy-ui image is published ([#183](https://github.com/zackwag/caddy-ui/issues/183)) ([c6a3f0f](https://github.com/zackwag/caddy-ui/commit/c6a3f0fe49dc347c9ab9cba51d93d6fa98df5d54))

## [2.16.0](https://github.com/zackwag/caddy-ui/compare/v2.15.0...v2.16.0) (2026-10-11)


### Features

* show Dashboard server labels next to primary server IDs ([#184](https://github.com/zackwag/caddy-ui/issues/184)) ([38c2fe9](https://github.com/zackwag/caddy-ui/commit/38c2fe931f32b08bb931a1b1601e934b9ff049ea))

## [2.15.0](https://github.com/zackwag/caddy-ui/compare/v2.14.0...v2.15.0) (2026-10-11)


### Features

* clarify primary server ID and pick it from Caddy's live servers ([#181](https://github.com/zackwag/caddy-ui/issues/181)) ([cf5d2f6](https://github.com/zackwag/caddy-ui/commit/cf5d2f6198dc2c599070c046ec8fd03215e20df4))

## [2.14.0](https://github.com/zackwag/caddy-ui/compare/v2.13.1...v2.14.0) (2026-10-10)


### Features

* export the active theme as a custom-theme JSON file ([#176](https://github.com/zackwag/caddy-ui/issues/176)) ([c6642e9](https://github.com/zackwag/caddy-ui/commit/c6642e9fa78312f178361c9f5c18067291c30ef6))

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
