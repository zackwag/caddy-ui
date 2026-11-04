// The CodeMirror setup shared by the full Caddyfile editor and the route
// site-block editor, so both edit the same way. Components import this module
// dynamically, which keeps CodeMirror out of the main bundle.
import { autocompletion, closeBrackets, deleteBracketPair } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { StreamLanguage, bracketMatching, codeFolding, foldGutter, foldKeymap, foldService, indentOnInput, syntaxHighlighting } from '@codemirror/language';
import { Compartment, EditorState, Prec } from '@codemirror/state';
import { EditorView, drawSelection, highlightActiveLineGutter, highlightSpecialChars, keymap, lineNumbers } from '@codemirror/view';
import { classHighlighter } from '@lezer/highlight';
import { caddyfile } from '../lib/caddyfileMode.js';
import { indentation, indentationKeymap, structureOf } from './caddyfileIndentation.js';
import { createCompletionSource } from './caddyfileCompletions.js';
import { foldRangeOf, isLiteralAt } from './caddyfileStructure.js';

// Typing one of these inserts its closing partner, and typing that partner
// next to it steps over it. Quotes aren't paired: Caddyfile text uses them
// sparingly, and an apostrophe in `respond` text would gain a stray partner.
const BRACKET_PAIRS = new Map([['(', ')'], ['[', ']'], ['{', '}']]);
const BRACKETS = [...BRACKET_PAIRS.keys()];
const BRACKET_CHARACTERS = new Set([...BRACKETS, ...BRACKET_PAIRS.values()]);

// Inside a comment, quoted token or heredoc a bracket is text, so it's typed
// as is instead of being paired or stepping over an earlier completion. This
// includes pairs created before their surrounding text became a literal.
const literalBrackets = Prec.high(EditorView.inputHandler.of((view, from, to, text) => {
    if (!BRACKET_CHARACTERS.has(text) || !isLiteralAt(structureOf(view.state.doc), from)) {
        return false;
    }
    // eslint-disable-next-line i18next/no-literal-string -- CodeMirror user event name, not UI copy
    view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length }, userEvent: 'input.type', scrollIntoView: true });
    return true;
}));

function deleteCodeBracketPair(view) {
    const { state } = view;
    // Ordinary Backspace must not require a full structure scan. Only inspect
    // context when every caret is between one of the configured bracket pairs.
    if (state.readOnly || !state.selection.ranges.every(range => range.empty && range.from > 0
        && BRACKET_PAIRS.get(state.doc.sliceString(range.from - 1, range.from)) === state.doc.sliceString(range.from, range.from + 1))) {
        return false;
    }
    const structure = structureOf(state.doc);
    if (state.selection.ranges.some(range => isLiteralAt(structure, range.from))) {
        return false;
    }
    return deleteBracketPair(view);
}

// Let the default Backspace delete one character in literals; paired deletion
// is only appropriate in code, regardless of how the pair was inserted.
// eslint-disable-next-line i18next/no-literal-string -- CodeMirror key name, not UI copy
const bracketKeymap = [{ key: 'Backspace', run: deleteCodeBracketPair }];

// Global, site, snippet, matcher and nested directive blocks fold from their
// opening line, using the same structure as indentation. A block needs at least
// one line between its braces to be worth folding.
const caddyfileFolding = foldService.of((state, lineStart) => {
    const line = state.doc.lineAt(lineStart);
    const range = foldRangeOf(structureOf(state.doc), line);
    return range && state.doc.lineAt(range.to).number > line.number + 1 ? range : null;
});

// CodeMirror's English fold labels, in the UI's language.
function editorPhrases(t) {
    /* eslint-disable i18next/no-literal-string -- CodeMirror phrase keys, not UI copy */
    return {
        'Fold line': t('caddyfile.foldBlock'),
        'Unfold line': t('caddyfile.unfoldBlock'),
        'folded code': t('caddyfile.foldedBlock'),
        'unfold': t('caddyfile.unfoldBlock'),
    };
    /* eslint-enable i18next/no-literal-string */
}

// Colors read from the CSS theme variables (see styles.js) rather than being
// hardcoded per theme here, so a new theme needs no changes in this file.
function editorTheme({ dark, padding }) {
    return EditorView.theme({
        '&': { background: 'var(--editor-bg)', color: 'var(--text)', fontSize: '13px', fontFamily: "'IBM Plex Mono', monospace" },
        '.cm-content': { padding, caretColor: 'var(--accent)', lineHeight: '1.7' },
        '.cm-gutters': { background: 'var(--editor-gutter)', color: 'var(--muted)', border: 'none', borderRight: '1px solid var(--editor-border)', paddingRight: '8px' },
        '.cm-activeLineGutter': { background: 'var(--editor-active-gutter)' },
        '.cm-activeLine': { background: 'var(--editor-active-line)' },
        '.cm-cursor': { borderLeftColor: 'var(--accent)' },
        '.cm-selectionBackground, ::selection': { background: 'var(--editor-selection) !important' },
        '.cm-line': { padding: '0 4px' },
        '.tok-keyword': { color: 'var(--accent)' },
        '.tok-string': { color: 'var(--warn)' },
        '.tok-comment': { color: 'var(--muted)', fontStyle: 'italic' },
        '.tok-number': { color: 'var(--accent2)' },
        '.tok-operator': { color: 'var(--text)' },
        '.tok-variableName': { color: 'var(--danger)' },
        '.tok-typeName': { color: 'var(--accent)' },
        '.tok-atom': { color: 'var(--warn)' },
        '.tok-propertyName': { color: 'var(--accent2)' },
        '.tok-variableName2': { color: 'var(--accent3)' },
        '& .cm-scroller': { overflow: 'auto' },
        '.cm-foldGutter .cm-gutterElement': { color: 'var(--muted)', padding: '0 4px', cursor: 'pointer' },
        '.cm-foldGutter .cm-gutterElement:hover': { color: 'var(--accent)' },
        '.cm-foldPlaceholder': { background: 'var(--editor-active-line)', border: '1px solid var(--editor-border)', color: 'var(--muted)', borderRadius: '3px', margin: '0 2px', padding: '0 4px' },
        '.cm-tooltip': { background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)' },
        '.cm-tooltip-autocomplete ul li': { padding: '2px 8px' },
        '.cm-tooltip-autocomplete ul li[aria-selected]': { background: 'var(--accent)', color: 'var(--on-accent)' },
    }, { dark });
}

// Creates an editor for `doc` in `parent`. `onChange` receives the full text
// after each edit, and `t` translates the editor's own labels. Nothing here
// rewrites the document on load, and folding never changes it: content only
// changes through the user's own edits.
export function createCaddyfileEditor({ parent, doc, dark, padding, onChange, t, siteBlock = false }) {
    const phrasesCompartment = new Compartment();
    const state = EditorState.create({
        doc,
        extensions: [
            phrasesCompartment.of(EditorState.phrases.of(editorPhrases(t))),
            lineNumbers(), caddyfileFolding, foldGutter(), codeFolding(), highlightActiveLineGutter(), highlightSpecialChars(),
            history(), drawSelection(), indentOnInput(), bracketMatching(),
            EditorState.languageData.of(() => [{ closeBrackets: { brackets: BRACKETS } }]),
            literalBrackets, closeBrackets(),
            autocompletion({ override: [createCompletionSource(siteBlock)], activateOnTyping: true }),
            syntaxHighlighting(classHighlighter),
            StreamLanguage.define(caddyfile), editorTheme({ dark, padding }),
            indentation,
            keymap.of([...bracketKeymap, ...indentationKeymap, ...foldKeymap, ...defaultKeymap, ...historyKeymap]),
            EditorView.updateListener.of(update => {
                if (update.docChanged) {
                    onChange(update.state.doc.toString());
                }
            }),
            EditorView.lineWrapping,
        ],
    });
    const view = new EditorView({ state, parent });
    view.updatePhrases = (t) => view.dispatch({ effects: phrasesCompartment.reconfigure(EditorState.phrases.of(editorPhrases(t))) });
    return view;
}
