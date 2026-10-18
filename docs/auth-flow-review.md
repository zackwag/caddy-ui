# Authentication flow reviewer guide

This changes browser authentication from environment-backed login JWTs to stored administrator credentials and server-side cookie sessions. It keeps a single administrator and the Caddyfile-first model. It does not introduce user-owned metadata, a database, roles, passkeys or integration API tokens.

## Review order

1. **Credential persistence:** `src/backend/src/authStore.js` and `src/backend/test/authStore.test.js`. Check missing versus invalid storage, scrypt hashing, owner-only permissions, exclusive initialization and atomic replacement. Existing settings, labels and history are never rewritten by this module.
2. **Session and CSRF boundary:** `src/backend/src/authSessions.js`, `src/backend/src/middleware/csrf.js` and `src/backend/test/authSessions.test.js`. Check cookie attributes, expiration, session rotation, token binding and stream revocation. No browser write has a headerless exemption.
3. **Credential lifecycle:** `src/backend/src/authService.js`, `src/backend/src/routes/auth.js`, `src/backend/src/middleware/auth.js` and their HTTP tests. Check that legacy login grants enrollment only, stored credentials win after successful setup, persistence errors preserve current access, and recovery consumes/rotates its key without creating a bypass session.
4. **Application wiring:** `src/backend/src/index.js`. Authentication initializes before the listener opens. Origin and CSRF checks precede handlers. Public metrics exemptions allow reads only. The login limiter counts writes, rather than status/CSRF reads.
5. **Browser behavior:** `src/frontend/src/utils/api.js`, `App.jsx`, `Login.jsx`, `AuthSetup.jsx` and `AuthRecovery.jsx`. Check server-authoritative session state, explicit recovery-key acknowledgement and failure handling. Streams/downloads use cookies rather than URL tokens. Failed mutations are not automatically replayed.
6. **Policy:** the separate `feat: make authentication opt-out explicit` commit adds `CADDY_UI_AUTH_DISABLED`. Review this product decision independently: setup/login is the default, while a deliberate opt-out retains CSRF protection.
7. **Compatibility and operation:** development/capture clients obtain a CSRF context and keep `AUTH_PATH` isolated. README authentication instructions are canonical; Docker Hub descriptions are generated from them.

## Authentication states

| Credential state | Behavior |
| --- | --- |
| Stored credentials | Normal password login |
| Legacy environment credentials only | Existing login, then credential enrollment |
| Neither | Credential setup, regardless of whether UI metadata already exists |
| Corrupt, unreadable or unsupported credential file | Startup failure, not fresh setup |
| Explicit authentication opt-out | Management access without login, CSRF still required for writes |

There is no installation-age detection or metadata migration. The administrator username exists in authentication storage; server labels and route metadata retain their existing identities.

## Deliberate limits and deployment decisions

- First-time setup follows the first-visitor-claims policy. Management endpoints stay locked until setup succeeds; restrict access while uninitialized.
- HTTP works, including ordinary non-trustworthy HTTP browser origins. It cannot protect credentials against network interception. Configure `CADDY_UI_EXTERNAL_URL` with the external HTTPS URL behind TLS-terminating proxies so cookies are Secure.
- Sessions are process-local and expire after 24 hours; restarts sign everyone out. Enrollment/pre-login contexts expire after 10 minutes. This assumes one backend process.
- Recovery keys are displayed once, stored only as hashes and rotated on use. Losing both password and key requires an intentional filesystem reset while access is restricted.
- Existing Bearer JWTs and query-string tokens stop working. Scoped integration tokens belong to P2; coordinate deployment for installations relying on authenticated scripts/widgets.
- Explicitly disabling authentication also disables credential setup/login/recovery. It preserves the credential file and does not bypass CSRF or origin checks.

## Reproducible checks

```sh
npm ci --prefix src/backend
npm ci --prefix src/frontend
npm ci --prefix dev
npm ci --prefix docs --ignore-scripts
npm test --prefix src/backend
npm run lint --prefix src/backend
npm test --prefix src/frontend
npm run lint --prefix src/frontend -- --max-warnings=0
npm run build --prefix src/frontend
npm run test:dev-caddy
npm run lint:dev-caddy
npm run test:dev-caddy:integration
npm exec --prefix dev -- playwright install chromium
npm run test:dev-caddy:e2e
npm run i18n:preview:check-browser
npm run i18n:preview:check-capture
npm test --prefix docs
node .github/scripts/dockerhub-docs.mjs --dry-run
```

Run Docker integration and browser suites sequentially: Docker network creation can disturb Chromium network state. Integration/capture checks require Docker; `node --test dev/e2e/auth.mjs` exercises the real backend and Vite UI without Docker after preparing the editor mode.

The authentication browser scenarios cover setup, legacy enrollment, recovery, cookie attributes, CSRF rejection, retained settings, absence of URL credentials and backend-unavailable behavior. Backend HTTP tests additionally exercise logout/recovery stream invalidation and persistence failures. The pre-existing browser suite covers live logs, editor actions, diagnostics and locale behavior with the updated request client.
