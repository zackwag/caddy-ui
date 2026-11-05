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
import { indentation, indentationKeymap, insertIndentation, insertNewlinePreservingIndent, structureOf } from './caddyfileIndentation.js';
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

// Save and quit handlers per editor. Vim ex commands are registered globally,
// so each command looks up the editor it was typed in.
const vimHandlers = new WeakMap();
let vimLoaded;
let vimEditorOf = () => null;

/* eslint-disable i18next/no-literal-string -- Vim command names and messages, shown in vim's own English like its built-in ones */
// In vim's message area, like its own errors. Throwing from a command would
// show the message too, but also surface as an uncaught page error.
function showVimMessage(cm, text) {
    const message = document.createElement('div');
    message.className = 'cm-vim-message';
    message.style.color = 'var(--danger)';
    message.textContent = text;
    cm.openNotification(message, { bottom: true, duration: 15000 });
}

// `:w` and `:wq` save, and `:x` saves only with changes. Where the editor can
// be closed (`onQuit`), saving is expected to close it, `:x` without changes
// just closes, and `:q` refuses to discard changes unless it's `:q!`.
function defineVimCommands(Vim) {
    const handlersOf = cm => vimHandlers.get(cm.cm6) ?? {};
    Vim.defineEx('write', 'w', cm => handlersOf(cm).onSave?.());
    Vim.defineEx('wq', 'wq', cm => handlersOf(cm).onSave?.());
    Vim.defineEx('xit', 'x', cm => {
        const { onSave, onQuit, isModified } = handlersOf(cm);
        if (!onQuit || isModified?.()) onSave?.();
        else onQuit();
    });
    Vim.defineEx('quit', 'q', (cm, params) => {
        const { onQuit, isModified } = handlersOf(cm);
        if (!onQuit) showVimMessage(cm, `Not an editor command ":${params.input}"`);
        else if (params.argString?.trim() !== '!' && isModified?.()) showVimMessage(cm, 'E37: No write since last change (add ! to override)');
        else onQuit();
    });
}
/* eslint-enable i18next/no-literal-string */

// Loaded only when vim mode is on, and its commands are registered once per page.
function loadVim() {
    vimLoaded ??= import('@replit/codemirror-vim').then(({ vim, Vim, CodeMirror, getCM }) => {
        vimEditorOf = getCM;
        defineVimCommands(Vim);
        // `o` and `O` open their line the way Enter does, so existing
        // indentation is kept and a new block is indented. Tagged like the
        // adapter's own newline, so undo groups it the same way.
        CodeMirror.commands.newlineAndIndent = cm => insertNewlinePreservingIndent({
            state: cm.cm6.state,
            // eslint-disable-next-line i18next/no-literal-string -- CodeMirror user event name, not UI copy
            dispatch: tr => cm.cm6.dispatch({ changes: tr.changes, selection: tr.selection, scrollIntoView: true, userEvent: 'input.type.compose.start' }),
        });
        return vim;
    });
    return vimLoaded;
}

// In vim's normal mode Tab is left to the browser, so it moves focus out of the
// editor instead of changing text. Insert mode and visual selections indent.
function vimLeavesTab(view) {
    const state = vimEditorOf(view)?.state.vim;
    return Boolean(state && !state.insertMode && !state.visualMode);
}

const editorIndentationKeymap = indentationKeymap.map(binding => binding.run === insertIndentation ? {
    ...binding,
    run: view => !vimLeavesTab(view) && binding.run(view),
    shift: view => !vimLeavesTab(view) && binding.shift(view),
} : binding);

// `#` comments, used by vim's `gc`. Only while vim is on, so the plain editor's
// keymap is unchanged.
const vimLanguageData = EditorState.languageData.of(() => [{ commentTokens: { line: '#' } }]);

// Creates an editor for `doc` in `parent`. `onChange` receives the full text
// after each edit, and `t` translates the editor's own labels. Nothing here
// rewrites the document on load, and folding never changes it: content only
// changes through the user's own edits. With `vimMode`, vim keybindings and a
// mode status bar are added, and its save and quit commands call `onSave`,
// `onQuit` and `isModified` (see defineVimCommands). `view.setVimMode` switches
// vim later without rebuilding the editor, so undo history survives.
export function createCaddyfileEditor({ parent, doc, dark, padding, onChange, t, vimMode = false, onSave, onQuit, isModified }) {
    const phrasesCompartment = new Compartment();
    const vimCompartment = new Compartment();
    const state = EditorState.create({
        doc,
        extensions: [
            // Before the other keymaps, so vim sees keys first
            vimCompartment.of([]),
            phrasesCompartment.of(EditorState.phrases.of(editorPhrases(t))),
            lineNumbers(), caddyfileFolding, foldGutter(), codeFolding(), highlightActiveLineGutter(), highlightSpecialChars(),
            history(), drawSelection(), indentOnInput(), bracketMatching(),
            EditorState.languageData.of(() => [{ closeBrackets: { brackets: BRACKETS } }]),
            literalBrackets, closeBrackets(),
            autocompletion({ override: [createCompletionSource()], activateOnTyping: true }),
            syntaxHighlighting(classHighlighter),
            StreamLanguage.define(caddyfile), editorTheme({ dark, padding }),
            indentation,
            keymap.of([...bracketKeymap, ...editorIndentationKeymap, ...foldKeymap, ...defaultKeymap, ...historyKeymap]),
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
    // Vim loads on first use. Ignore stale requests and views closed meanwhile.
    let vimRequest = 0;
    view.setVimMode = async (enabled) => {
        const request = ++vimRequest;
        const vim = enabled ? await loadVim() : null;
        if (request === vimRequest && !view.destroyed) {
            view.dispatch({ effects: vimCompartment.reconfigure(vim ? [vim({ status: true }), vimLanguageData] : []) });
        }
    };
    vimHandlers.set(view, { onSave, onQuit, isModified });
    if (vimMode) {
        view.setVimMode(true);
    }
    return view;
}
