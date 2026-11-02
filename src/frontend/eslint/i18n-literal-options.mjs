// Technical literals that are not user-facing copy.
// Keep this list broad enough to avoid implementation noise, but narrow enough
// that normal English UI text still reaches i18next/no-literal-string.

export default {
    mode: 'all',

    'jsx-attributes': {
        exclude: [
            '^className$',
            '^path$',
            '^to$',
            '^key$',
            '^value$',
            '^type$',
            '^id$',
            '^name$',
            '^style$',
            '^role$',
            '^href$',
            '^src$',
            '^data-',
            '^col$',
            // Catalog key for <Trans>.
            '^i18nKey$',
            // Credential verification takes a DOM ID and a catalog key.
            '^passwordId$',
            '^passwordLabel$',
        ],
    },

    callees: {
        exclude: [
            '^navigate$',
            '^t$',
            '^i18n\\.t$',
            // Incident key constructors take internal identifiers, not UI text.
            '^stateNotificationKey$',
            '^document\\.createElement$',
            '^window\\.open$',
        ],
    },

    'object-properties': {
        exclude: [
            // Catalog key stored in state and translated at render time.
            '^errorKey$',
            // The notification policy 'mode' is an internal enum.
            '^mode$',
            // CSS-in-JS / inline-style properties.
            '^(background|backgroundColor|color|font.*|lineHeight|caretColor|border.*|padding.*|margin.*|width|height|minWidth|minHeight|maxWidth|maxHeight|overflow.*|display|gap|alignItems|justifyContent|textAlign|textTransform|letterSpacing|cursor|opacity|boxShadow|flex.*|position|top|right|bottom|left|whiteSpace|behavior|block)$',
        ],
    },

    words: {
        exclude: [
            // DOM/browser behavior
            '^(keydown|mousedown)$',

            // Log source identifiers and export filename prefixes.
            '^(app|caddy|caddy-access|caddy-ui)$',

            // internal state
            '^(new|err|warn|default|unauthorized|del|add|equal|skip)$',
            '^NO_INSTANCES$',

            // Log source IDs, query parameter and export filename prefixes.
            '^(app|caddy|dist|caddy-access|caddy-ui)$',

            // DOM and browser storage identifiers
            '^root$',
            '^caddy_ui_(token|auth_enabled|instance)$',

            // HTTP metadata
            '^content-type$',

            // protocols / IDs
            '^(http|https)$',
            '^srv\\d+$',

            // Prometheus percentile identifiers
            '^p(50|95|99)$',

            // Standard units / technical configuration values
            '^ms$',
            '^\\d+(?:kb|mb|gb)$',

            // Structured log fragments
            '^"level":"(?:error|warn|info)"$',

            // Product / service names that are not translated
            "^(Discord|Slack|Pushover|Let's Encrypt)$",

            // Internal TLD examples
            '^\\.(?:internal|home)$',

            // ISO timestamp marker
            '^Z$',

            // Empty/default values and stable application identifiers.
            '^$',
            '^en$',
            '^dark$',
            '^light$',
            '^vt2026$',
            '^coarse-everywhere$',
            '^caddy/ui$',

            // Paths, URLs, CSS variables and DOM data attributes.
            '^/.*$',
            '^https?://',
            '^--.*$',
            '^var\\(--[a-z0-9-]+\\)$',
            '^data-[a-z0-9-]+$',

            // Protocol / serialization values.
            '^(application/json|text/plain)$',
            '^(GET|POST|PUT|PATCH|DELETE)$',
            '^(DEBUG|INFO|WARN|ERROR)$',

            // Internal state and provider identifiers.
            '^(success|error|info)$',
            '^(online|offline|unknown|partial|maintenance|pending|none)$',
            '^(all|asc|desc|diff|raw|current|domain|title|upstream|server|status|expires|days|filter)$',
            '^(json|console|acme|orphaned|superseded|valid|expiring|expired)$',
            '^(ntfy|discord|slack|pushover|custom)$',

            // Intl option values and formatToParts part types.
            '^(short|numeric|2-digit|percent|percentSign|literal)$',

            // Platform names used as data labels in the CA instruction map.
            '^(iOS / iPadOS|macOS|Android|Windows)$',

            // Pure punctuation / symbols.
            '^[^A-Za-zÀ-ž]+$',
        ],
    },
};
