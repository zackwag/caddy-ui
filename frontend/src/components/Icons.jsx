// Original monochrome artwork on a 16px grid. Sidebar/theme marks use whole
// pixels; utility marks keep a light stroke. Icons are decorative: their parent
// control supplies the translated accessible name.
const PIXEL_PATHS = {
    dashboard: [
        'M7 1h2v1h1v1h1v1h1v1h1v1h1v1h1v2h-1v1h-1v1h-1v1h-1v1h-1v1H9v1H7v-1H6v-1H5v-1H4v-1H3v-1H2V9H1V7h1V6h1V5h1V4h1V3h1V2h1Z M7 3v1H6v1H5v1H4v1H3v2h1v1h1v1h1v1h1v1h2v-1h1v-1h1v-1h1V9h1V7h-1V6h-1V5h-1V4H9V3Z',
        'M7 6h2v1h1v2H9v1H7V9H6V7h1Z',
    ],
    caddyfile: [
        'M5 2h1v3h4V2h1v3h3v1h-3v4h3v1h-3v3h-1v-3H6v3H5v-3H2v-1h3V6H2V5h3Zm1 4v4h4V6Z',
    ],
    routes: [
        'M2 4h9V2h1v1h1v1h1v1h-1v1h-1v1h-1V5H2Z',
        'M14 11H5v2H4v-1H3v-1H2v-1h1V9h1V8h1v2h9Z',
    ],
    tls: [
        'M5 1h6v1h2v1h1v2h1v6h-1v2h-1v1h-2v1H5v-1H3v-1H2v-2H1V5h1V3h1V2h2Zm0 1v1H3v2H2v6h1v2h2v1h6v-1h2v-2h1V5h-1V3h-2V2Z',
        'M7 4h2v3h3v2H9v3H7V9H4V7h3Z',
    ],
    logs: ['M3 4h10v1H3Zm0 4h10v1H3Zm0 4h10v1H3Z'],
    metrics: ['M1 8h2V5h1V3h2v1h1v3h1v3h1v2h1v-1h1V8h2V7h2v1h-1v1h-2v3h-1v1H8v-2H7V8H6V5H5V4H4v2H3v3H1Z'],
    notifications: [
        'M5 1h6v1h2v1h1v2h1v6h-1v2h-1v1h-2v1H5v-1H3v-1H2v-2H1V5h1V3h1V2h2Zm0 1v1H3v2H2v6h1v2h2v1h6v-1h2v-2h1V5h-1V3h-2V2Z',
        'M11 3h1v2h-1v2h-1v2H9v2H8v2H7v1H6v-2h1v-2h1V8h1V6h1V4h1Z',
    ],
    instances: [
        'M2 2h12v12H2Zm1 1v4h4V3Zm6 0v4h4V3Zm-6 6v4h4V9Zm6 0v4h4V9Z',
    ],
    logout: [
        'M7 1h2v7H7Z',
        'M4 3h1v2H4v1H3v5h1v1h1v1h6v-1h1v-1h1V6h-1V5h-1V3h1v1h1v1h1v2h1v4h-1v2h-1v1h-2v1H5v-1H3v-1H2v-2H1V7h1V5h1V4h1Z',
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
