# Noto-derived icon outlines

`noto-glyphs.json` contains selected glyph outlines from Noto Sans Symbols,
Noto Sans Symbols2 and Noto Sans Math, licensed under SIL OFL 1.1. These are SVG
paths, not a font subset: no TTF, WOFF, font request or font dependency is shipped.
The original UI characters are mapped individually in `sources.json`, including
the power symbol U+23FB used for logout.

The custom sun, moon, counterclockwise refresh and maintenance wrench remain in
`components/Icons.jsx`. They are not extracted from Noto.

## Sources and license

- Upstream: <https://github.com/notofonts/noto-fonts>
- Source package: `fonts-noto-core 20201225-2` (source package `fonts-noto`).
- Source archive: <https://sources.debian.org/src/fonts-noto/20201225-2/>
- Exact font filenames, versions, SHA-256 values and copyright notices:
  [`sources.json`](sources.json).
- Full copyright and license notice:
  [`public/licenses/noto-icons-OFL.txt`](../../../public/licenses/noto-icons-OFL.txt).
  Vite copies this notice to `/licenses/noto-icons-OFL.txt` in the built frontend.

The Noto-derived paths retain their OFL-1.1 license; the surrounding application
keeps its existing license. No Microsoft font outlines are included.

## Regenerate

This is a manual maintenance step, not a build prerequisite. Install
`fonttools==4.61.1` in a Python virtual environment and obtain the font files from
the source package above. Normal development, CI and application builds use the
checked-in JSON and do not require Python or the fonts.

From `frontend/`:

```sh
python scripts/export-icon-glyphs.py --font-dir /path/to/noto-fonts
python scripts/export-icon-glyphs.py --font-dir /path/to/noto-fonts --check
```

The exporter rejects fonts whose hashes differ from the recorded versions,
requires every selected glyph to exist, preserves the outline proportions and
centers each glyph in the existing 16px canvas. Glyphs use their font em scale
unless they need shrinking to preserve a 1px canvas margin. Coordinates are
rounded to three decimal places. No font hinting or platform rasterization is
preserved, so SVGs can differ slightly from their former text rendering.
