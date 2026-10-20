# Security and passkeys

Open **Security** in the sidebar to manage the administrator account, passkeys and API tokens. TOTP support will follow separately.

## Set up HTTPS first

Passkeys require a browser-supported, secure HTTPS connection to **Caddy UI itself**. Serving another application through HTTPS does not secure your UI connection. Put the frontend behind an HTTPS reverse proxy, trust its certificate on your devices, and reopen the UI at that HTTPS address. The TLS tab lets you inspect the managed Caddy instance's certificates; it does not automatically place the UI behind HTTPS.

Set the backend's `CADDY_UI_EXTERNAL_URL` to the same browser-facing address, including its scheme and external port, for example `https://caddy-ui.example.com`. Restart the backend after changing it. The configured origin and hostname are used for WebAuthn verification; forwarded headers are not used to infer them. IP addresses cannot be used as WebAuthn RP IDs; use a DNS hostname (or HTTPS localhost for development). Keep this hostname stable: moving to another hostname can require registering passkeys again.

The Auth section distinguishes an HTTP connection, an unsupported browser and missing or mismatched backend configuration. Enrollment stays disabled until those requirements are met. Password login remains available over HTTP; passkeys are intentionally HTTPS-only, including on localhost.

## Add a passkey

1. Sign in and open **Security → Auth**.
2. Give the passkey a recognizable name, such as “Laptop” or “Phone”.
3. Confirm your current password. This is required for **every** addition.
4. Choose an authenticator in the browser prompt and complete its fingerprint, face or PIN verification.

Use an up-to-date browser and an authenticator supporting discoverable FIDO2 credentials and user verification. The browser and operating system control the available device, security key and password manager choices; Caddy UI does not force a particular provider.

The administrator can register **three passkeys**. A passkey synchronized by a provider can be available on several devices while counting as one registered credential. Removing a credential in Caddy UI revokes that credential across all its synchronized copies.

## Sign in and remove passkeys

After registration, the login page offers **Sign in with a passkey**. No username entry is needed. On a different HTTPS origin, the button is disabled and a message identifies the configured address to open. Password sign-in remains available if the authenticator is missing, broken or unavailable.

Remove a passkey under **Security → Auth**. Deleting **any** passkey requires your current password, even if other passkeys remain. Any removal signs out all previous sessions and live log streams, including sessions that the removed credential may have opened, and renews the browser performing the removal. API tokens and the recovery key remain valid.

Ordinary username and password changes preserve passkeys. A stable stored account identifier keeps them independent of the administrator's username. Authenticators may continue to display the username used when the credential was created.

## Persistence and recovery

Public keys, credential identifiers, the account identifier and verification metadata are saved atomically alongside credential hashes in `AUTH_PATH` (default `/etc/caddy-ui/auth.json`). Preserve the backend's `/etc/caddy-ui` volume, or your custom auth file's persistent mount, across image upgrades, rebuilds and container replacements. There is no separate database. The private key remains with the authenticator or its passkey provider.

A backend restart signs out browser sessions and discards pending challenges, but preserves registered passkeys. Failed credential writes leave the prior auth record intact; a failed registration must be started again, including password confirmation. If the authenticator retained a credential from that failed attempt, remove that unused entry through its provider before retrying if necessary.

Keep your password and recovery key available. Account recovery rotates the recovery key and removes **all passkeys, API tokens and sessions** so a lost or compromised credential cannot regain access. Sign in using the replacement password and register your trusted authenticators again.

## Verification and testing

Registration and sign-in use SimpleWebAuthn with required user verification, exact configured origin and RP ID checks, and session-bound challenges that expire after two minutes. Challenges are consumed once; registration rechecks the three-key limit when it finishes. Writes use the existing CSRF protection and auth rate limiter. Successful sign-in persists verification counters before issuing a session; authenticators that legitimately use zero counters are supported.

Automated tests include signed WebAuthn assertions, failure and concurrency cases, and Chromium virtual authenticators over a pinned test HTTPS certificate. Browser coverage replaces the backend process and signs in using the persisted passkey. Actual Windows Hello, phone, security key and password manager prompts should also be checked manually before release; virtual authenticator tests cannot establish device-specific compatibility.
