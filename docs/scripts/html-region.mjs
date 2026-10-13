import { SAXParser } from 'parse5-sax-parser';

const CODE_ELEMENTS = new Set(['pre', 'code', 'script', 'style', 'textarea']);

// Read one HTML token, or a complete code element, starting at source offset 0.
// Locations refer to the original source: never serialize or sanitize the HTML.
export function readHtmlRegion(source) {
    const parser = new SAXParser({ sourceCodeLocationInfo: true });
    let region = null;
    let depth = 0;
    let finalizing = false;

    function finish(kind, token) {
        if (token.sourceCodeLocation.startOffset === 0) {
            region = {
                kind,
                endOffset: token.sourceCodeLocation.endOffset,
                // Complete comments are emitted during write; an EOF-terminated
                // comment is emitted only when the stream is finalized.
                unclosed: kind === 'comment' && finalizing,
            };
        }
        parser.stop();
    }

    parser.on('startTag', token => {
        if (region?.kind === 'element') {
            if (token.tagName === region.name) depth++;
        } else if (token.sourceCodeLocation.startOffset === 0 && CODE_ELEMENTS.has(token.tagName)) {
            region = { kind: 'element', name: token.tagName, endOffset: source.length, unclosed: true };
            depth = 1;
        } else {
            finish('tag', token);
        }
    });
    parser.on('endTag', token => {
        if (region?.kind !== 'element') {
            finish('tag', token);
        } else if (token.tagName === region.name && --depth === 0) {
            region.endOffset = token.sourceCodeLocation.endOffset;
            region.unclosed = false;
            parser.stop();
        }
    });
    parser.on('comment', token => {
        if (!region) finish('comment', token);
    });
    parser.on('doctype', token => {
        if (!region) finish('tag', token);
    });
    parser.on('text', () => {
        if (!region) parser.stop();
    });

    parser.write(source);
    finalizing = true;
    parser.end();
    parser.destroy();
    return region;
}
