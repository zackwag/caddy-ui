#!/usr/bin/env python3
"""Export selected, licensed Noto outlines; not part of the application build.

Install fonttools==4.61.1 and supply fonts-noto-core 20201225-2.
See src/assets/icons/README.md for provenance and reproduction instructions.
"""

import argparse
import hashlib
import json
from pathlib import Path

from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont


FONTS = {
    'symbols': ('NotoSansSymbols-Regular.ttf', '24b615ceb7d50a2c09060664ca9e24a160c9beb6bfca0563e8359369a4bc0993'),
    'symbols2': ('NotoSansSymbols2-Regular.ttf', '876598db5f1e3bef2bc77c4d94c5b0d5d2c1620be4878a06f18fb5434e331688'),
    'math': ('NotoSansMath-Regular.ttf', '8242bd1e55368b27e32455260754cf9aa58f3ad7ea80664b66c21f1b09910d6c'),
}

# Restore the original UI characters, retaining custom sun/moon, refresh and wrench.
GLYPHS = {
    'dashboard': ('symbols2', '\u25c8'),
    'caddyfile': ('symbols', '\u2317'),
    'routes': ('math', '\u21cc'),
    'tls': ('math', '\u2295'),
    'logs': ('math', '\u2261'),
    'metrics': ('math', '\u223f'),
    'notifications': ('math', '\u2298'),
    'instances': ('math', '\u229e'),
    'logout': ('symbols2', '\u23fb'),
    'caretDown': ('symbols2', '\u25be'),
    'caretUp': ('symbols2', '\u25b4'),
    'external': ('math', '\u2197'),
    'arrowDown': ('math', '\u2193'),
    'menu': ('symbols2', '\u2630'),
    'pencil': ('symbols2', '\u270e'),
    'info': ('symbols', '\u24d8'),
    'arrowUp': ('math', '\u2191'),
    'arrowRight': ('math', '\u2192'),
    'sort': ('math', '\u2195'),
    'close': ('symbols2', '\u2715'),
    'play': ('symbols2', '\u25b6'),
    'stop': ('symbols2', '\u25a0'),
    'check': ('symbols2', '\u2713'),
    'warning': ('symbols2', '\u26a0'),
    'history': ('math', '\u2299'),
    'dot': ('symbols2', '\u25cf'),
    'settings': ('symbols', '\u2699'),
}


def number(value):
    return f'{value:.3f}'.rstrip('0').rstrip('.') if value else '0'


def export(font_dir):
    fonts = {}
    provenance = {'sourcePackage': 'fonts-noto-core 20201225-2', 'fonts': {}, 'glyphs': {}}
    for key, (filename, expected) in FONTS.items():
        path = font_dir / filename
        actual = hashlib.sha256(path.read_bytes()).hexdigest()
        if actual != expected:
            raise ValueError(f'{filename}: expected SHA-256 {expected}, got {actual}')
        font = TTFont(path)
        fonts[key] = font
        provenance['fonts'][key] = {
            'file': filename,
            'sha256': actual,
            'family': font['name'].getDebugName(1),
            'version': font['name'].getDebugName(5),
            'copyright': font['name'].getDebugName(0),
            'license': 'OFL-1.1',
        }

    paths = {}
    for name, (key, char) in GLYPHS.items():
        font = fonts[key]
        glyph_name = font.getBestCmap().get(ord(char))
        if glyph_name is None:
            raise ValueError(f'{name}: U+{ord(char):04X} missing from {key}')
        glyph_set = font.getGlyphSet()
        glyph = glyph_set[glyph_name]
        bounds_pen = BoundsPen(glyph_set)
        glyph.draw(bounds_pen)
        if bounds_pen.bounds is None:
            raise ValueError(f'{name}: glyph has no outline')
        x_min, y_min, x_max, y_max = bounds_pen.bounds
        # Preserve proportions and the font's em scale; only shrink oversized
        # glyphs to leave a 1px margin. Center ink in the existing 16px canvas.
        scale = min(16 / font['head'].unitsPerEm, 14 / max(x_max - x_min, y_max - y_min))
        transform = (scale, 0, 0, -scale,
                     8 - scale * (x_min + x_max) / 2,
                     8 + scale * (y_min + y_max) / 2)
        pen = SVGPathPen(glyph_set, ntos=number)
        glyph.draw(TransformPen(pen, transform))
        paths[name] = pen.getCommands()
        provenance['glyphs'][name] = {
            'font': key,
            'codePoint': f'U+{ord(char):04X}',
            'glyph': glyph_name,
        }
    return paths, provenance


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--font-dir', type=Path, default=Path('/usr/share/fonts/truetype/noto'))
    parser.add_argument('--check', action='store_true', help='Fail if checked-in exports differ')
    args = parser.parse_args()
    output = Path(__file__).resolve().parents[1] / 'src/assets/icons'
    paths, provenance = export(args.font_dir)
    for name, data in [('noto-glyphs.json', paths), ('sources.json', provenance)]:
        text = json.dumps(data, indent=2, ensure_ascii=True) + '\n'
        path = output / name
        if args.check:
            if not path.exists() or path.read_text() != text:
                raise SystemExit(f'{path.name}: export differs; regenerate with the pinned fonts')
        else:
            path.write_text(text)
    print(f'{"Verified" if args.check else "Exported"} {len(paths)} Noto SVG glyphs')


if __name__ == '__main__':
    main()
