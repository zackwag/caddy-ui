// Stable application error contracts. Route handlers own the semantic code;
// HTTP status is a transport default, not the source of error meaning.
export const ERROR_REGISTRY = Object.freeze({
    REQUEST_FAILED: { status: 500, level: 'error' },
    VALIDATION_FAILED: { status: 400, level: 'warn' },
    CADDYFILE_VALIDATION_FAILED: { status: 422, level: 'warn' },
    CADDYFILE_READ_FAILED: { status: 500, level: 'error' },
    CADDYFILE_WRITE_FAILED: { status: 500, level: 'error' },
    CADDYFILE_CHANGE_REJECTED: { status: 422, level: 'warn' },
    CADDYFILE_ROLLBACK_FAILED: { status: 500, level: 'error' },
    CADDYFILE_HISTORY_READ_FAILED: { status: 500, level: 'error' },
    ROUTE_NOTES_READ_FAILED: { status: 500, level: 'error' },
    CADDY_RELOAD_FAILED: { status: 502, level: 'error' },
    INSTANCE_NOT_FOUND: { status: 404, level: 'warn' },
    INSTANCE_SELECTION_INVALID: { status: 404, level: 'warn' },
    INSTANCE_CONNECTION_FAILED: { status: 502, level: 'error' },
    INSTANCE_DISCOVERY_FAILED: { status: 500, level: 'error' },
    INSTANCE_SAVE_FAILED: { status: 500, level: 'error' },
    INSTANCE_REMOVE_FAILED: { status: 500, level: 'error' },
    CERTIFICATE_DELETE_DENIED: { status: 403, level: 'warn' },
    CERTIFICATE_DELETE_FAILED: { status: 500, level: 'error' },
    CERTIFICATE_READ_FAILED: { status: 500, level: 'error' },
    CERTIFICATE_CA_UNAVAILABLE: { status: 502, level: 'error' },
    METRICS_UNAVAILABLE: { status: 503, level: 'warn' },
    METRICS_CONFIG_FAILED: { status: 500, level: 'error' },
    CADDY_STATUS_UNAVAILABLE: { status: 503, level: 'warn' },
    CADDY_CONFIG_UNAVAILABLE: { status: 503, level: 'warn' },
    LOG_FILE_MISSING: { status: 404, level: 'warn' },
    LOG_STREAM_ERROR: { status: 500, level: 'error' },
    UNAUTHORIZED: { status: 401, level: 'warn' },
    FORBIDDEN: { status: 403, level: 'warn' },
    WEBHOOK_DESTINATION_BLOCKED: { status: 403, level: 'warn' },
    NOTIFICATION_SEND_FAILED: { status: 502, level: 'error' },
    RATE_LIMITED: { status: 429, level: 'warn' },
    NOT_FOUND: { status: 404, level: 'warn' },
    CONFLICT: { status: 409, level: 'warn' },
    UPSTREAM_UNAVAILABLE: { status: 502, level: 'error' },
    NO_INSTANCES: { status: 503, level: 'warn' },
});

export function errorDefinition(code) {
    return Object.hasOwn(ERROR_REGISTRY, code) ? ERROR_REGISTRY[code] : ERROR_REGISTRY.REQUEST_FAILED;
}
