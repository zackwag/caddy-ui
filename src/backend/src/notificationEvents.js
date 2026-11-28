// What caddy/ui notifies about, separate from how it's delivered. Each event
// has a stable id, the trigger that turns it on, the variables its producer
// supplies, and its default title, message and priority.
//
// Titles and messages are templates: `{name}` is replaced by that variable's
// value, and nothing is evaluated. A line whose variables are all empty is left
// out, so optional details don't leave a blank label behind.

// Every variable an event can supply. Values are strings, formatted for reading.
export const VARIABLES = {
    instance: 'Name of the instance the event is about',
    instancePrefix: 'The instance name in brackets, followed by a space, when caddy/ui manages several instances; otherwise empty',
    upstream: 'Address of the upstream, as Caddy dials it (`host:port`)',
    label: 'The upstream with the domains it serves, such as `app.example.com (10.0.0.5:8080)`, or just its address',
    route: 'Host name the route check requested',
    failure: 'Why the route check failed, such as `HTTP 502` or a connection error',
    certificate: 'Name the certificate was issued for, such as `*.example.com`',
    days: 'Whole days until expiry',
    expiresIn: '`days` with its unit, such as `1 day` or `3 days`',
    expiresOn: 'Expiry date, as `YYYY-MM-DD`',
    token: 'Name of the API token (never its secret)',
    versions: 'Each component with an update, such as `backend v3.10.0 → v3.11.0`',
    releaseNotes: 'Link to the release notes',
    method: 'Sign-in method id: `password`, `password-totp`, `totp`, `passkey` or `recovery`',
    methodName: 'Sign-in method in words, such as `Password sign-in`',
    outcome: '`success` or `failure`',
    timestamp: 'When it happened, as an ISO 8601 timestamp',
    sourceIp: 'IP address the attempt came from, or `unknown`',
    count: 'How many more happened during the cooldown',
    changed: 'What changed: `Caddyfile`, `live configuration`, or both',
    detectedAt: 'When the change was detected, as an ISO 8601 timestamp',
    historyEntry: 'Caddyfile history entry holding the changed file, or empty',
};

export const PRIORITIES = ['low', 'default', 'high'];

const UPSTREAM = ['instance', 'instancePrefix', 'upstream', 'label'];
const ROUTE = ['instance', 'instancePrefix', 'route'];
const AUTHENTICATION = ['method', 'methodName', 'outcome', 'timestamp', 'sourceIp'];
const AUTHENTICATION_DETAILS = 'Time: {timestamp}\nMethod: {method}\nOutcome: {outcome}\nSource IP: {sourceIp}';
const AUTHENTICATION_SUMMARY = '{count} additional failed {method} attempts during the cooldown. Latest attempt: {timestamp}. Latest source IP: {sourceIp}.';
const CONFIGURATION = ['instance', 'changed', 'detectedAt', 'historyEntry'];
const CONFIGURATION_DETAILS = 'Changed: {changed}\nDetected: {detectedAt}\nSource: unknown, outside a tracked caddy/ui operation\nHistory entry: {historyEntry}';

export const NOTIFICATION_EVENTS = {
    'upstream.offline': {
        trigger: 'upstreamOffline', variables: UPSTREAM,
        title: 'Upstream offline', message: '{instancePrefix}{label} is unreachable', priority: 'high',
    },
    'upstream.online': {
        trigger: 'upstreamOnline', variables: UPSTREAM,
        title: 'Upstream recovered', message: '{instancePrefix}{label} is back online', priority: 'default',
    },
    'route.offline': {
        trigger: 'routeOffline', variables: [...ROUTE, 'failure'],
        title: 'Route down', message: '{instancePrefix}{route} is down: {failure}', priority: 'high',
    },
    'route.online': {
        trigger: 'routeOnline', variables: ROUTE,
        title: 'Route recovered', message: '{instancePrefix}{route} is back up', priority: 'default',
    },
    'certificate.expiring': {
        trigger: 'certExpiring', variables: ['instance', 'instancePrefix', 'certificate', 'days', 'expiresIn'],
        title: 'Certificate expiring', message: '{instancePrefix}{certificate} expires in {expiresIn}', priority: 'high',
    },
    'apiToken.expiring': {
        trigger: 'apiTokenExpiring', variables: ['token', 'days', 'expiresIn', 'expiresOn'],
        title: 'API token expiring', message: 'API token "{token}" expires in {expiresIn} ({expiresOn})', priority: 'high',
    },
    'update.available': {
        trigger: 'updateAvailable', variables: ['versions', 'releaseNotes'],
        title: 'caddy/ui update available', message: '{versions}. Release notes: {releaseNotes}', priority: 'default',
    },
    'authentication.succeeded': {
        trigger: 'authentication', variables: AUTHENTICATION,
        title: '{methodName} succeeded', message: AUTHENTICATION_DETAILS, priority: 'default',
    },
    'authentication.failed': {
        trigger: 'authentication', variables: AUTHENTICATION,
        title: '{methodName} failed', message: AUTHENTICATION_DETAILS, priority: 'default',
    },
    'authentication.failedRepeatedly': {
        trigger: 'authentication', variables: [...AUTHENTICATION, 'count'],
        title: '{methodName} failed', message: AUTHENTICATION_SUMMARY, priority: 'default',
    },
    // A password that worked although stronger passkeys are set up, which can mean it leaked
    'authentication.passwordFallback': {
        trigger: 'authentication', variables: AUTHENTICATION,
        title: 'Password sign-in while passkeys are configured', message: AUTHENTICATION_DETAILS, priority: 'high',
    },
    'recovery.succeeded': {
        trigger: 'authentication', variables: AUTHENTICATION,
        title: '{methodName} succeeded', message: AUTHENTICATION_DETAILS, priority: 'high',
    },
    'recovery.failed': {
        trigger: 'authentication', variables: AUTHENTICATION,
        title: '{methodName} failed', message: AUTHENTICATION_DETAILS, priority: 'high',
    },
    'recovery.failedRepeatedly': {
        trigger: 'authentication', variables: [...AUTHENTICATION, 'count'],
        title: '{methodName} failed', message: AUTHENTICATION_SUMMARY, priority: 'high',
    },
    'configuration.changed': {
        trigger: 'configurationChange', variables: CONFIGURATION,
        title: 'Configuration changed outside caddy/ui', message: `Instance: {instance}\n${CONFIGURATION_DETAILS}`, priority: 'high',
    },
    'configuration.changedRepeatedly': {
        trigger: 'configurationChange', variables: [...CONFIGURATION, 'count'],
        title: 'Configuration changed outside caddy/ui',
        message: `{count} additional unexplained configuration changes on {instance} during the cooldown.\n${CONFIGURATION_DETAILS}`,
        priority: 'high',
    },
    // Sent from the settings page, whatever the triggers
    test: {
        trigger: null, variables: [],
        title: 'caddy/ui test', message: 'Notifications are working correctly.', priority: 'low',
    },
};

const PLACEHOLDER = /\{([A-Za-z]+)\}/g;

// The variables a template names, in order.
export function templateVariables(template) {
    return [...template.matchAll(PLACEHOLDER)].map(([, name]) => name);
}

export function renderTemplate(template, data) {
    // Own properties only, so `{constructor}` can't reach the prototype
    const value = name => (!Object.hasOwn(data, name) || data[name] === undefined || data[name] === null ? '' : String(data[name]));
    return template.split('\n').filter(line => {
        const names = templateVariables(line);
        return !names.length || names.some(name => value(name));
    }).join('\n').replace(PLACEHOLDER, (_, name) => value(name));
}

// The alert for `event`, given its variables.
export function renderNotification(event, data = {}) {
    const definition = NOTIFICATION_EVENTS[event];
    if (!definition) {
        throw new Error(`Unknown notification event: ${event}`);
    }
    return {
        title: renderTemplate(definition.title, data),
        message: renderTemplate(definition.message, data),
        priority: definition.priority,
    };
}
