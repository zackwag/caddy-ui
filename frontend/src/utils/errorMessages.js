// Never surface server-supplied text as translated UI copy. The backend logs
// technical detail under a request ID, while this catalog describes the outcome.
export function localizeError(error, t) {
    const code = error?.code || error?.errorCode;
    switch (code) {
        case 'UNAUTHORIZED': return t('errors.unauthorized');
        case 'RATE_LIMITED': return t('errors.rateLimited');
        case 'VALIDATION_FAILED':
        case 'CADDYFILE_VALIDATION_FAILED': return t('errors.validationFailed');
        case 'NOT_FOUND': return t('errors.notFound');
        case 'CONFLICT': return t('errors.conflict');
        case 'UPSTREAM_UNAVAILABLE':
        case 'CADDY_STATUS_UNAVAILABLE': return t('errors.upstreamUnavailable');
        case 'METRICS_UNAVAILABLE': return t('errors.metricsUnavailable');
        case 'NETWORK_ERROR': return t('errors.network');
        default: return t('errors.generic');
    }
}
