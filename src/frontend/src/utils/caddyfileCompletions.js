// Context-sensitive Caddyfile directive completions. Offers directives,
// global options or subdirectives depending on where the caret sits, and
// nothing inside comments, quoted tokens or heredocs. Vocabulary is
// imported from the generated caddyfileMode.js (single source of truth).

import { DIRECTIVES, GLOBAL_OPTIONS, SUBDIRECTIVES } from '../lib/caddyfileMode.js';
import { structureOf } from './caddyfileIndentation.js';
import { contextKind, isLiteralAt } from './caddyfileStructure.js';

function toCompletions(words, type) {
    return words.map(label => ({ label, type }));
}

// Pre-built completion lists from the imported vocabulary sets.
// eslint-disable-next-line i18next/no-literal-string -- CodeMirror completion type, not UI copy
const directiveCompletions = toCompletions([...DIRECTIVES], 'keyword');
// eslint-disable-next-line i18next/no-literal-string -- CodeMirror completion type, not UI copy
const globalCompletions = toCompletions([...GLOBAL_OPTIONS], 'keyword');
// eslint-disable-next-line i18next/no-literal-string -- CodeMirror completion type, not UI copy
const subdirectiveCompletions = toCompletions([...SUBDIRECTIVES], 'property');

function vocabularyFor(kind) {
    if (kind === 'global') {
        return globalCompletions;
    }
    if (kind === 'directive') {
        return directiveCompletions;
    }
    if (kind === 'subdirective') {
        return subdirectiveCompletions;
    }
    return [];
}

// The CodeMirror CompletionSource wired into autocompletion().
export function createCompletionSource() {
    return function caddyfileCompletionSource(context) {
        const { state, pos } = context;
        const word = context.matchBefore(/[a-zA-Z_]\w*/);
        if (!word && !context.explicit) {
            return null;
        }

        const structure = structureOf(state.doc);
        if (isLiteralAt(structure, pos)) {
            return null;
        }

        // Only complete at the start of a token on the line (first word
        // position or after leading whitespace). Skip if the caret follows
        // a non-whitespace, non-word character on the same line.
        const line = state.doc.lineAt(pos);
        const before = line.text.slice(0, pos - line.from);
        if (word && before.slice(0, word.from - line.from).trim().length > 0) {
            // The word isn't the first token on its line — could be an
            // argument, not a directive name. Don't offer completions.
            return null;
        }

        const kind = contextKind(structure, state.doc.toString(), pos);
        const options = vocabularyFor(kind);
        if (!options.length) {
            return null;
        }

        return {
            from: word ? word.from : pos,
            options,
            validFor: /^[a-zA-Z_]\w*$/,
        };
    };
}
