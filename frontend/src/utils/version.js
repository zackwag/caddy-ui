export const RELEASES_URL = "https://github.com/zackwag/caddy-ui/releases";

export function isNewerVersion(latest, current) {
    const parse = value => {
        const match = String(value).match(/^v?(\d+)\.(\d+)\.(\d+)$/);
        return match ? match.slice(1).map(Number) : null;
    };

    const a = parse(latest);
    const b = parse(current);

    if (!a || !b) return false;

    for (let i = 0; i < 3; i++) {
        if (a[i] !== b[i]) return a[i] > b[i];
    }

    return false;
}
