import glyphs from '../assets/icons/noto-glyphs.json';

// Selected Noto outlines are licensed under OFL-1.1. Their exact font sources
// and export procedure are recorded in assets/icons/README.md and sources.json.
// Every icon is decorative; its parent supplies the translated accessible name.
export function SymbolIcon({ name, size = 16 }) {
    return (
        <svg className="ui-icon" width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" focusable="false">
            <path d={glyphs[name]} />
        </svg>
    );
}

// Keep the approved original sun and moon artwork.
const PIXEL_PATHS = {
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

// Preserve the approved custom counterclockwise refresh and open-jaw wrench.
const CUSTOM_UTILITY_PATHS = {
    refresh: 'M10 3a5.5 5.5 0 1 1-4-.5M14 3h-4v4',
    wrench: 'M10 1 7.5 3.5l3 3 3-3a4 4 0 0 1-5 5L4 13a1.4 1.4 0 0 1-2-2l4.5-4.5A4 4 0 0 1 10 1Z',
};
const GLYPH_ALIASES = { chevronDown: 'caretDown', download: 'arrowDown' };

export function UtilityIcon({ name, size = 12 }) {
    if (!CUSTOM_UTILITY_PATHS[name]) return <SymbolIcon name={GLYPH_ALIASES[name] || name} size={size} />;
    return (
        <svg className="ui-icon" width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="square" strokeLinejoin="miter" aria-hidden="true" focusable="false">
            <path d={CUSTOM_UTILITY_PATHS[name]} fill="none" stroke="currentColor" />
        </svg>
    );
}
