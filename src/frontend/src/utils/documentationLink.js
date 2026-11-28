const DOCUMENTATION_URL = 'https://zackwag.github.io/caddy-ui/resolve.html';

// Send only known component versions. The published resolver owns channel,
// component-choice and historical-book fallback policy.
export function documentationLink({ frontend, backend } = {}) {
    const url = new URL(DOCUMENTATION_URL);
    if (typeof frontend === 'string' && frontend.trim()) {
        // eslint-disable-next-line i18next/no-literal-string -- Published resolver query key, not UI copy.
        url.searchParams.set('frontend', frontend.trim());
    }
    if (typeof backend === 'string' && backend.trim()) {
        // eslint-disable-next-line i18next/no-literal-string -- Published resolver query key, not UI copy.
        url.searchParams.set('backend', backend.trim());
    }
    return url.href;
}
