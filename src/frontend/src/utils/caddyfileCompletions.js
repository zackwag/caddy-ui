// Context-sensitive Caddyfile directive completions. Offers directives,
// global options or subdirectives depending on where the caret sits, and
// nothing inside comments, quoted tokens or heredocs. Vocabulary is
// imported from the generated caddyfileMode.js (single source of truth).
// Snippet completions with tab stops are mixed in from caddyfileSnippets.js.

import { snippetCompletion } from '@codemirror/autocomplete';
import { DIRECTIVES, GLOBAL_OPTIONS, SUBDIRECTIVES } from '../lib/caddyfileMode.js';
import { structureOf } from './caddyfileIndentation.js';
import { contextKind, isLiteralAt } from './caddyfileStructure.js';
import { snippetsForContext } from './caddyfileSnippets.js';

/* eslint-disable i18next/no-literal-string -- CodeMirror completion metadata, not UI copy */

function toCompletions(words, type) {
    return words.map(label => ({ label, type }));
}

// Pre-built completion lists from the imported vocabulary sets.
const directiveCompletions = toCompletions([...DIRECTIVES], 'keyword');
const globalCompletions = toCompletions([...GLOBAL_OPTIONS], 'keyword');
const subdirectiveCompletions = toCompletions([...SUBDIRECTIVES], 'property');

// Snippet completions built once per context from the curated templates.
// Each gets a `detail` suffix and a negative boost so it sorts after the
// plain directive name, letting the user discover it without it jumping
// ahead of the exact match. Site blocks (context 'none') are skipped:
// they don't start with a directive keyword, so the context menu is the
// better insertion path.
function buildSnippetCompletions(kind) {
    const completions = [];
    for (const cat of snippetsForContext(kind)) {
        for (const snippet of cat.snippets) {
            if (!snippet.snippetTemplate) continue;
            // The label is the first word of the template so it matches
            // when the user types a directive name.
            const label = snippet.template.split(/[\s\n{]/)[0];
            completions.push(snippetCompletion(snippet.snippetTemplate, {
                label,
                detail: ` — ${snippet.key}`,
                type: 'text',
                boost: -1,
            }));
        }
    }
    return completions;
}

const snippetsByContext = {
    directive: buildSnippetCompletions('directive'),
    global: buildSnippetCompletions('global'),
};

/* eslint-enable i18next/no-literal-string */

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

        // Both typed and empty prefixes must be the first token on the line.
        // Ctrl+Space after a directive's arguments isn't a name completion.
        const from = word ? word.from : pos;
        const line = state.doc.lineAt(pos);
        if (state.doc.sliceString(line.from, from).trim().length > 0) {
            return null;
        }

        const kind = contextKind(structure, state.doc.toString(), pos);
        const vocab = vocabularyFor(kind);
        const snippets = snippetsByContext[kind] ?? [];
        const options = [...vocab, ...snippets];
        if (!options.length) {
            return null;
        }

        return {
            from,
            options,
            validFor: /^[a-zA-Z_]\w*$/,
        };
    };
}
