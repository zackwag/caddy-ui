# Notifications

Configure a provider and enable notifications on the **Notifications** page. Save the settings before using **Send test**: the test sends through the backend using the saved configuration. Monitor alerts use the same delivery path.

## Self-hosted ntfy on a private network

Public ntfy URLs work without extra configuration. For Docker, LAN, or other internal endpoints, the backend operator must approve **both the complete topic URL and its destination network**. The Notifications page still selects the active topic; environment configuration only grants permission to use it.

For example, add these environment variables to the **backend** service:

```yaml
environment:
  CADDY_UI_NTFY_ALLOWED_INTERNAL_URLS: '["http://ntfy:80/caddy-alerts"]'
  CADDY_UI_NTFY_ALLOWED_INTERNAL_NETWORKS: '["172.28.0.0/16"]'
```

Replace the example network with the subnet actually assigned to the ntfy service. Both containers must share a reachable network; an allowlist does not create a Docker network, publish a port, or make an unreachable service accessible. For a LAN installation, use the LAN hostname/topic and its subnet instead.

Recreate the backend container after changing its environment. On the Notifications page, choose **ntfy**, enter `http://ntfy/caddy-alerts`, enable notifications, save, and send a test. Use HTTPS when the network is not trusted. For private certificate authorities, mount a CA bundle and configure Node's `NODE_EXTRA_CA_CERTS`; certificate verification remains enabled.

### Matching and network rules

- Both allowlists are JSON arrays of strings. Empty/unset lists grant no internal access. Invalid settings block ntfy delivery with a configuration error; other providers continue to work. Settings are read when ntfy is first used and require a backend restart to change.
- URLs match in full after standard URL normalization: scheme, hostname, non-default port, topic path, and query string. Hostname case and explicit default ports normalize; a different topic, port, or query does not match. User information and fragments are rejected. No wildcard or prefix matching is supported.
- Network entries use IPv4 or IPv6 CIDR notation, for example `192.168.178.0/24` or `fd12:3456::/48`. The URL list and network list form one shared policy: any listed URL may use any listed subnet. Use IPv4 CIDRs for IPv4-mapped IPv6 answers.
- A listed endpoint must stay within the approved networks even if DNS later resolves it to a public IP. An unlisted URL must resolve entirely to public addresses. The exception applies only to ntfy, never to Discord, Slack, or custom webhooks.
- DNS is checked on every delivery. For a listed endpoint with multiple answers, one approved address is selected; unapproved addresses cannot be used as connection fallbacks. An approved IPv4 answer can be used even if an IPv6 answer is outside policy. Only that selected address is attempted; a connection failure is reported rather than falling back to another address.
- `0.0.0.0/0` deliberately permits all otherwise eligible IPv4 destinations for the listed URLs; `::/0` does the same for IPv6. They are independent. Narrower subnets reduce the destinations a compromised DNS response could reach.
- Loopback and link-local destinations require additional explicit opt-ins: `CADDY_UI_NTFY_ALLOW_LOOPBACK=true` and `CADDY_UI_NTFY_ALLOW_LINK_LOCAL=true`, respectively. They still require URL and subnet matches. Loopback refers to the **backend's network namespace**, not automatically the Docker host. Link-local access can include cloud metadata services; grant it only for an intentional endpoint. Unspecified, multicast, and reserved IPv4 high-range addresses remain blocked even with these flags.

The sender pins the validated address to the HTTP connection, preserving the original Host header and HTTPS hostname verification. It never follows redirects: configure the final topic URL instead. DNS lookup has a five-second deadline; the HTTP request has a ten-second deadline and a 64 KiB response limit.

### Diagnostics and trust boundary

Backend logs emit `ntfy.addresses_changed` whenever a previously observed address set changes, including the previous/new addresses, hostname, endpoint identifier, and `allowed`/`blocked` decision. A change within an approved subnet remains permitted. A result outside policy emits `ntfy.destination_blocked` and stops delivery. `ntfy.destination_approved` records successful policy checks at debug level. Topic paths and query strings are omitted from these policy events.

Address observations are bounded, in-memory diagnostics. They reset on restart and never grant permission; every send must pass the current policy. A change in DNS ordering alone is not an address change.

The policy limits where UI-configured notifications can send requests. It does not authenticate an HTTP server within an approved subnet or prevent an operator from intentionally granting broad access. HTTPS and a trusted certificate remain the server identity check. Keep backend configuration and notification settings limited to trusted operators.

### Troubleshooting

- `internal_url_not_approved`: the active URL does not exactly match the URL allowlist, or an unlisted endpoint resolved to a non-public destination.
- `outside_internal_policy`: no resolved address passed the subnet policy and the applicable loopback/link-local checks. Check both A and AAAA records from the backend's network namespace.
- `dns_lookup_failed` / `invalid_or_empty_dns_answer`: check container DNS, hostname spelling, and resolution from the backend.
- Connection timeout/refusal: check reachability and the ntfy listener; policy approval does not establish connectivity.
- Redirect error: replace the configured URL and allowlist entry with the final topic URL.
- Certificate error: fix the hostname/certificate or supply the appropriate private CA. Do not disable TLS verification.
