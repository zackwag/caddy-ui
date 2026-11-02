# Authenticator codes (TOTP)

Open **Security → Auth → Authenticator app (TOTP)** and choose **Set up authenticator**. Security sections start collapsed. TOTP adds a six-digit authenticator code to password sign-in. A passkey remains sufficient on its own; it does not also require TOTP.

## Set up or replace an authenticator

1. Verify with your current password, or a fresh passkey ceremony if you already have a compatible passkey. When TOTP is already enabled, the password option also requires a current authenticator code.
2. Scan the QR code in your authenticator app, or enter the displayed setup key manually. Caddy UI generates the QR code in your browser without contacting an external QR service.
3. Enter a code from the new authenticator and choose **Confirm authenticator**.

Setup expires after five minutes or five incorrect confirmation attempts. Until confirmation, the proposed seed lives only in the current backend session; closing the panel does not enable it. **Cancel** discards it. During replacement, the existing authenticator remains active until the new one is confirmed. Confirmation saves the new enrollment atomically, revokes previous sessions and live log streams, and renews your browser's session.

Only one TOTP enrollment is active for the administrator. The implementation uses HMAC-SHA1, six digits and a 30-second period, compatible with common authenticator apps. Keep the backend host and authenticator device clocks synchronized. One adjacent time step in either direction is accepted for clock drift. Once accepted, a code's time step cannot be used again, including after a backend restart. If you just signed in or changed a credential, wait for a new code before another protected action.

## Sign-in and credential changes

Password sign-in first checks the username and password, then asks for the authenticator code. The intermediate session cannot manage Caddy, read protected APIs or create integration tokens. It expires after five minutes or five failed code attempts. Go back to sign-in to restart, use a passkey, or recover your account.

Changing the password, adding/removing any passkey, and enabling/replacing/disabling TOTP require fresh verification:

- A passkey is offered first when it is usable at the current HTTPS origin. The signed challenge authorizes one named action, in one session, for two minutes. The resulting authorization can be attempted once and cannot be reused for a different change or target passkey.
- Password plus TOTP remains available when TOTP is enabled; otherwise the current password suffices. Having a passkey does not remove this fallback.

A username-only change still requires the current password, without an authenticator code. API-token creation retains its current management-session and CSRF requirements; stronger reauthentication for that operation is a separate follow-up.

Disabling TOTP removes the stored seed and returns password sign-in to password-only. It requires the same fresh verification and revokes previous sessions, while keeping the verified caller signed in. Normal credential changes preserve API tokens and the recovery key.

## Account-wide cooldown

Active TOTP verification shares one persistent failure budget across password sign-in and password-plus-TOTP credential changes. Five consecutive failed checks trigger a five-minute cooldown. Starting another password sign-in, changing the username or restarting the backend does not clear it. Requests during the cooldown return `TOTP_RATE_LIMITED` (HTTP 429) with a `Retry-After` header and do not extend the deadline. A successful TOTP check resets the consecutive-failure count, and an expired cooldown starts a fresh budget.

Only requests that have already verified the password and have the required pending or management session can consume this budget. Anonymous requests and wrong passwords cannot trigger the TOTP cooldown. The existing per-IP auth write limiter remains in place as an additional control. Confirmation of a proposed enrollment retains its separate five-attempt limit.

Existing management sessions remain usable during cooldown. Passkey sign-in, fresh passkey verification and recovery remain available; recovery removes the TOTP seed and its failure state. Someone who knows the password can trigger another temporary cooldown after the previous one expires, so passkeys and the recovery key remain useful alternatives. No permanent suspension or manual unlock is introduced.

## Persistence, backups and recovery

The TOTP seed and last accepted time step are stored in `AUTH_PATH` (default `/etc/caddy-ui/auth.json`), alongside the password/recovery hashes and passkey records. The seed must be recoverable by the backend to verify codes; **it is not a password hash and is not encrypted by Caddy UI**. The file is owner-only (`0600`), and replacements use the existing atomic credential writes. Failed writes do not grant access or replace the active enrollment.

While TOTP is active, the auth record uses format version 2. Older images that only support version 1 refuse to start instead of silently skipping the second factor. Disable TOTP using a supported backend before downgrading; disabling it or completing recovery returns the record to version 1.

Keep the backend auth volume mounted persistently across container recreation, upgrades and rebuilds. **Backups of that volume contain the TOTP seed**, so protect them like credentials. Host or dataset encryption is recommended for offline theft and backup protection. A key stored alongside the seed would travel with the same backup and is deliberately not added here. File permissions and disk encryption do not protect credentials from an attacker controlling the running backend or an account that can read its auth volume.

Save the recovery key supplied during account setup. Recovery sets a replacement password, rotates the recovery key, **disables TOTP**, and revokes all passkeys, API tokens and browser sessions. Save the replacement key, sign in using the new password, and enroll trusted authenticators again. The old TOTP device cannot regain access using its codes.

## HTTP and HTTPS

Authenticator codes work over HTTP and HTTPS. The HTTP panel warns that passwords, setup keys, codes and session cookies can be intercepted. TOTP does not encrypt the connection or stop a live interception attack; HTTPS is strongly recommended. Passkeys remain HTTPS-only with the configured matching origin.

## API sequence

All endpoints below require the existing session-bound CSRF header and use the auth write rate limiter. Responses are `Cache-Control: no-store`.

- Password login: `POST /api/auth/sessions` returns `{ ok: true, totpRequired: true }` when the password is correct and TOTP is enabled. Complete it with `POST /api/auth/sessions/totp`, body `{ code }`. Fetch fresh CSRF state after each session change.
- Enrollment: `POST /api/auth/totp/setup` with fresh credential proof returns `{ secret, uri, expiresAt }` once. `POST /api/auth/totp/confirm`, body `{ code }`, activates the proposed seed. `DELETE /api/auth/totp/setup` cancels a proposal. `DELETE /api/auth/totp` disables the active enrollment using fresh proof.
- Password proof: `{ currentPassword, totpCode }` (omit `totpCode` when disabled). Passkey proof: `{ reauthToken }`, obtained with a fresh assertion through `POST /api/auth/passkeys/reauthentication/options` and `POST /api/auth/passkeys/reauthentication`.
- The reauthentication options body is `{ action }`: `password.change`, `totp.setup`, `totp.disable`, `passkey.add`, or `passkey.remove:<credential-id>`. Submit the browser assertion as the reauthentication body; its response supplies the one-use `reauthToken` for the corresponding operation.

Invalid/replayed codes use `TOTP_INVALID`; the shared cooldown uses `TOTP_RATE_LIMITED`; expired/exhausted login and setup attempts use `TOTP_CHALLENGE_EXPIRED` and `TOTP_SETUP_EXPIRED`. Expired, mismatched or reused passkey authorizations use `REAUTH_INVALID`. Storage failures remain `AUTH_PERSISTENCE_FAILED`. Seeds and codes are never deliberately logged or included in authentication notifications; password sign-in succeeds only after both checks finish.
