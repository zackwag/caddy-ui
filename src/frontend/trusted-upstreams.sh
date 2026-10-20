#!/bin/sh
set -eu
set -f

# Accept only IP/CIDR tokens, never nginx directives or shell fragments. nginx
# performs the remaining address validation when loading the generated config.
config="${1:-/etc/nginx/trusted-upstreams/proxies.conf}"
mkdir -p "$(dirname "$config")"
temporary="${config}.tmp"
trap 'rm -f "$temporary"' EXIT
printf '%s\n' 'real_ip_header X-Forwarded-For;' 'real_ip_recursive on;' > "$temporary"
previous_ifs="$IFS"
IFS=,
for entry in ${CADDY_UI_TRUSTED_UPSTREAMS:-}; do
    address=$(printf '%s' "$entry" | tr -d '[:space:]')
    case "$address" in
        ''|*[!0-9a-fA-F:./]*|*/0)
            printf '%s\n' 'CADDY_UI_TRUSTED_UPSTREAMS must contain specific proxy IP addresses or CIDRs' >&2
            exit 1
            ;;
    esac
    printf 'set_real_ip_from %s;\n' "$address" >> "$temporary"
done
IFS="$previous_ifs"
mv "$temporary" "$config"
