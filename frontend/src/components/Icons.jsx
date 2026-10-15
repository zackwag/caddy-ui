// Original monochrome terminal pictograms on a 16px grid. Filled silhouettes
// use block edges and cut-outs; utility marks keep a light stroke. Icons are decorative: their parent
// control supplies the translated accessible name.
const PIXEL_PATHS = {
    // A small dashboard display with four panes and a block stand.
    dashboard: [
        'M1 2h14v11H1Zm2 2v7h10V4Z',
        'M4 5h3v2H4Zm5 0h3v2H9ZM4 8h3v2H4Zm5 0h3v2H9ZM6 13h4v1h3v1H3v-1h3Z',
    ],
    // Folded configuration document with cut-out text lines.
    caddyfile: [
        'M3 1h6v1h2v2h2v11H3Zm6 2v2h2V4h-1V3ZM5 7h6v2H5Zm0 4h4v2H5Z',
    ],
    // One terminal-style connection branching into two destinations.
    routes: [
        'M1 6h4v4H1ZM11 1h4v4h-4Zm0 10h4v4h-4Z',
        'M5 7h2V2h4v2H9v8h2v2H7V9H5Z',
    ],
    tls: [
        'M6 1h4v1h2v5h2v8H2V7h2V2h2Zm0 2v4h4V3ZM7 9v3h2V9Z',
    ],
    // Block entries keep the visual rhythm of terminal output.
    logs: ['M1 2h3v3H1ZM6 2h9v3H6ZM1 7h3v3H1ZM6 7h7v3H6ZM1 12h3v3H1ZM6 12h9v3H6Z'],
    metrics: ['M2 9h3v5H2ZM7 5h3v9H7ZM12 1h3v13h-3ZM1 14h14v1H1Z'],
    notifications: [
        'M7 1h2v1h2v1h1v2h1v5h1v2H2v-2h1V5h1V3h1V2h2ZM5 5h2v4H5Z',
        'M6 13h4v2H6Z',
    ],
    instances: [
        'M2 1h12v6H2Zm2 2v2h2V3Zm5 0v2h3V3ZM2 9h12v6H2Zm2 2v2h2v-2Zm5 0v2h3v-2Z',
    ],
    // An exit through a door, with a stepped arrow instead of a power glyph.
    logout: [
        'M1 1h8v4H7V3H3v10h4v-2h2v4H1Z',
        'M10 3h2v2h2v2h1v2h-1v2h-2v2h-2v-3H6V6h4Z',
    ],
    sun: [
        'M6 4h4v1h1v1h1v4h-1v1h-1v1H6v-1H5v-1H4V6h1V5h1Zm0 2v4h4V6Z',
        'M7 0h2v2H7Zm0 14h2v2H7ZM0 7h2v2H0Zm14 0h2v2h-2ZM2 2h2v2H2Zm10 0h2v2h-2ZM2 12h2v2H2Zm10 0h2v2h-2Z',
    ],
    moon: [
        'M6 1h4v1H8v1H7v2H6v4h1v2h1v1h2v1h3v-1h1v-1h1v2h-2v1h-2v1H6v-1H4v-1H3v-2H2V5h1V3h1V2h2Zm5 2h1v1h1v1h-1v1h-1V5h-1V4h1Z',
    ],
};

export function PixelIcon({ name, size = 16 }) {
    return (
        <svg className="ui-icon" width={size} height={size} viewBox="0 0 16 16" fill="currentColor" shapeRendering="crispEdges" aria-hidden="true" focusable="false">
            {PIXEL_PATHS[name].map((d, index) => <path key={index} d={d} fillRule="evenodd" />)}
        </svg>
    );
}

const UTILITY_PATHS = {
    refresh: 'M13 6a5.5 5.5 0 1 0 .5 4M13 2v4H9',
    chevronDown: 'm5 6 3 3 3-3',
    external: 'M5 11 12 4M6 4h6v6',
    download: 'M8 2v10m-4-4 4 4 4-4M3 14h10',
    menu: 'M3 4h10M3 8h10M3 12h10',
};

export function UtilityIcon({ name, size = 12 }) {
    return (
        <svg className="ui-icon" width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="square" strokeLinejoin="miter" aria-hidden="true" focusable="false">
            <path d={UTILITY_PATHS[name]} />
        </svg>
    );
}
