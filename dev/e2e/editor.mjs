import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import en from '../../src/frontend/src/i18n/locales/en.js';
import { prepareBrowserTests, useBrowserFixture } from './fixture.mjs';

before(prepareBrowserTests, { timeout: 35000 });

// CodeMirror's tab focus mode toggle from the default keymap.
const TOGGLE_TAB_FOCUS = process.platform === 'darwin' ? 'Shift+Alt+m' : 'Control+m';
// Tab-indented on purpose: editing must keep existing tabs rather than convert them.
const SITE = 'site.test {\n\treverse_proxy app:3000\n    respond ok\n}';

// CodeMirror ignores Shift when matching a printed character, so Ctrl+Shift+z
// with a lowercase z reaches its Ctrl-z undo binding on Linux. Mod-y is redo
// everywhere except macOS, where Cmd+Shift+Z is.
const REDO = process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+y';

// CodeMirror's fold keys from its fold keymap.
const FOLD = process.platform === 'darwin' ? 'Meta+Alt+BracketLeft' : 'Control+Shift+BracketLeft';
const UNFOLD = process.platform === 'darwin' ? 'Meta+Alt+BracketRight' : 'Control+Shift+BracketRight';
const UNFOLD_ALL = 'Control+Alt+BracketRight';
const NESTED = 'site.test {\n\thandle /api/* {\n\t\treverse_proxy app:3000\n\t}\n\trespond "{ not a block"\n}';

const visibleText = root => root.locator('.cm-line').evaluateAll(lines => lines.map(line => line.textContent).join('\n'));

// Folding checks shared by both editors (#428). Folded lines aren't rendered,
// so the full text is compared after unfolding.
async function exerciseFolding(page, root, label) {
    const content = root.locator('.cm-content');
    // CodeMirror sizes each gutter with a hidden copy of a marker, so only visible ones count
    const foldMarkers = root.locator(`.cm-foldGutter [title="${en.caddyfile.foldBlock}"]`).filter({ visible: true });
    const unfoldMarkers = root.locator(`.cm-foldGutter [title="${en.caddyfile.unfoldBlock}"]`).filter({ visible: true });
    const placeholders = root.locator('.cm-foldPlaceholder');
    async function caretOn(line) {
        await page.keyboard.press('ControlOrMeta+Home');
        for (let i = 1; i < line; i++) {
            await page.keyboard.press('ArrowDown');
        }
    }

    await content.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.insertText(NESTED);
    assert.equal(await foldMarkers.count(), 2, `${label}: the site and handle blocks fold, a brace in a quoted token doesn't`);

    // Nested blocks fold independently through the gutter
    await foldMarkers.nth(1).click();
    assert.equal(await placeholders.count(), 1, label);
    assert.equal(await placeholders.first().getAttribute('aria-label'), en.caddyfile.foldedBlock, label);
    assert.equal(await visibleText(root), 'site.test {\n\thandle /api/* {…}\n\trespond "{ not a block"\n}', `${label}: only the handle body is hidden`);
    await foldMarkers.first().click();
    assert.equal(await visibleText(root), 'site.test {…}', `${label}: the site block folds around it`);
    await unfoldMarkers.first().click();
    assert.equal(await visibleText(root), 'site.test {\n\thandle /api/* {…}\n\trespond "{ not a block"\n}', `${label}: the inner fold survives unfolding the outer one`);
    await unfoldMarkers.first().click();
    assert.equal(await visibleText(root), NESTED, `${label}: folding never changes the text`);

    // The keyboard commands fold and unfold the block at the caret. Gutter
    // clicks leave focus outside the text, so return to it first.
    await content.focus();
    await caretOn(2);
    await page.keyboard.press(FOLD);
    assert.equal(await placeholders.count(), 1, `${label}: the fold key folds the block at the caret`);
    await page.keyboard.press(UNFOLD);
    assert.equal(await visibleText(root), NESTED, `${label}: the unfold key unfolds it`);

    // Editing elsewhere while folded keeps both the fold and the text
    await caretOn(1);
    await page.keyboard.press(FOLD);
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('# after');
    assert.equal(await placeholders.count(), 1, `${label}: an edit outside the fold keeps it folded`);
    await page.keyboard.press(UNFOLD_ALL);
    assert.equal(await visibleText(root), NESTED + '\n# after', label);
    for (let i = 0; i < 10 && await visibleText(root) !== NESTED; i++) {
        await page.keyboard.press('ControlOrMeta+z');
    }
    assert.equal(await visibleText(root), NESTED, `${label}: undo after folding restores the text`);
    assert.equal(await foldMarkers.count(), 2, `${label}: undo keeps the fold markers`);
}

// Keyboard checks shared by both editors, through real key events only.
async function exerciseEditor(page, root, label) {
    const content = root.locator('.cm-content');
    const text = () => root.locator('.cm-line').evaluateAll(lines => lines.map(line => line.textContent).join('\n'));
    const focused = () => content.evaluate(element => element === document.activeElement);
    // From the start of the document, so ArrowDown keeps column 0
    async function caretAt(line, { end = false } = {}) {
        await page.keyboard.press('ControlOrMeta+Home');
        for (let i = 1; i < line; i++) {
            await page.keyboard.press('ArrowDown');
        }
        if (end) {
            await page.keyboard.press('End');
        }
    }
    async function undoAll() {
        const visited = [await text()];
        for (let i = 0; i < 20 && visited.at(-1) !== SITE; i++) {
            await page.keyboard.press('ControlOrMeta+z');
            visited.push(await text());
        }
        assert.equal(visited.at(-1), SITE, `${label}: undo restores the document, through ${JSON.stringify(visited)}`);
    }

    await content.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.insertText(SITE);
    assert.equal(await text(), SITE, label);

    // Enter keeps the line's own indentation, tab or spaces (#429)
    await caretAt(2, { end: true });
    await page.keyboard.press('Enter');
    await page.keyboard.type('a');
    await caretAt(4, { end: true });
    await page.keyboard.press('Enter');
    await page.keyboard.type('b');
    assert.equal(await text(), 'site.test {\n\treverse_proxy app:3000\n\ta\n    respond ok\n    b\n}', `${label}: Enter keeps indentation`);
    await undoAll();
    await page.keyboard.press(REDO);
    assert.equal(await text(), 'site.test {\n\treverse_proxy app:3000\n\ta\n    respond ok\n}', `${label}: redo reapplies the first edit`);
    await undoAll();

    // Enter over a selection replaces it and leaves the caret after the indentation
    await caretAt(2, { end: true });
    for (let i = 0; i < 'app:3000'.length; i++) {
        await page.keyboard.press('Shift+ArrowLeft');
    }
    await page.keyboard.press('Enter');
    await page.keyboard.type('c');
    const replaced = (await text()).split('\n');
    assert.equal(replaced[1].trimEnd(), '\treverse_proxy', label);
    assert.equal(replaced[2], '\tc', `${label}: the caret follows the kept indentation`);
    await undoAll();

    // Tab at a caret inserts a literal tab without rewriting existing spaces.
    await caretAt(3, { end: true });
    await page.keyboard.press('Tab');
    await page.keyboard.type('d');
    assert.equal((await text()).split('\n')[2], '    respond ok\td', `${label}: Tab inserts a literal tab`);
    assert(await focused(), `${label}: Tab keeps focus in the editor`);
    await undoAll();

    // Tab and Shift+Tab move selected lines by one level. The selection ends at
    // the start of the closing line, which stays where it is.
    await caretAt(2);
    await page.keyboard.press('Shift+ArrowDown');
    await page.keyboard.press('Shift+ArrowDown');
    await page.keyboard.press('Tab');
    assert.equal(await text(), 'site.test {\n\t\treverse_proxy app:3000\n\t    respond ok\n}', `${label}: Tab indents the selected lines with tabs`);
    await page.keyboard.press('Shift+Tab');
    assert.equal(await text(), SITE, `${label}: Shift+Tab outdents them again`);
    await caretAt(1);
    await page.keyboard.press('Shift+Tab');
    assert.equal(await text(), SITE, `${label}: outdenting an unindented line changes nothing`);
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('ControlOrMeta+z');
    assert.equal(await text(), SITE, `${label}: an indentation is undone in one step`);

    // Brackets complete, and Enter between braces opens an indented body with
    // the closing brace aligned to its opening line (#431)
    await caretAt(2, { end: true });
    await page.keyboard.press('Enter');
    await page.keyboard.type('handle {');
    assert.equal((await text()).split('\n')[2], '\thandle {}', `${label}: { gains its closing brace`);
    await page.keyboard.press('Enter');
    await page.keyboard.type('respond (a) [b]');
    assert.equal(await text(), 'site.test {\n\treverse_proxy app:3000\n\thandle {\n\t\trespond (a) [b]\n\t}\n    respond ok\n}',
        `${label}: Enter adds a tab inside the tab-indented block, and typed closing brackets step over their completions`);
    await page.keyboard.type(' (');
    await page.keyboard.press('Backspace');
    assert.equal((await text()).split('\n')[3], '\t\trespond (a) [b] ', `${label}: Backspace removes a completed pair`);
    await undoAll();

    // In comments and quoted text a bracket is just text
    await caretAt(3, { end: true });
    await page.keyboard.type(' # see {');
    assert.equal((await text()).split('\n')[2], '    respond ok # see {', `${label}: no completion in a comment`);
    await page.keyboard.press('Enter');
    await page.keyboard.type('respond "{');
    assert.equal((await text()).split('\n')[3], '    respond "{', `${label}: no completion in a quoted token`);
    await undoAll();

    // A pair can be completed as code and then become literal text. Its
    // original completion must not swallow a closer or delete a second char.
    for (const context of [
        { name: 'comment', prefix: '# ' },
        { name: 'quoted token', prefix: '"' },
        { name: 'backtick token', prefix: '`' },
        { name: 'heredoc', prefix: '<<EOF', newline: true },
    ]) {
        for (const [opening, closing] of [['(', ')'], ['[', ']'], ['{', '}']]) {
            const literalLine = `    respond ok ${context.prefix}${context.newline ? '\n    ' : ''}`;
            async function preparePair() {
                await caretAt(3, { end: true });
                await page.keyboard.type(' ' + opening);
                await page.keyboard.press('ArrowLeft');
                await page.keyboard.type(context.prefix);
                if (context.newline) await page.keyboard.press('Enter');
                await page.keyboard.press('ArrowRight');
                assert.equal(await text(), SITE.replace('    respond ok', literalLine + opening + closing));
            }
            await preparePair();
            await page.keyboard.type(closing);
            assert.equal(await text(), SITE.replace('    respond ok', literalLine + opening + closing + closing),
                `${label}: typing ${closing} inserts text in a ${context.name}`);
            await undoAll();
            await preparePair();
            await page.keyboard.press('Backspace');
            assert.equal(await text(), SITE.replace('    respond ok', literalLine + closing),
                `${label}: Backspace removes only the preceding character in a ${context.name}`);
            await undoAll();
        }
    }

    // Pairs already present in literal text have the same single-character
    // Backspace behavior, without any completion metadata.
    await caretAt(3, { end: true });
    await page.keyboard.insertText(' "{}"');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('Backspace');
    assert.equal((await text()).split('\n')[2], '    respond ok "}"', `${label}: Backspace preserves the other bracket of a loaded literal pair`);
    await undoAll();


    // Keyboard-only ways out: Escape then Tab, or the tab focus mode toggle
    await content.focus();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Tab');
    assert(!await focused(), `${label}: Escape then Tab moves focus out of the editor`);
    assert.equal(await text(), SITE, label);
    await content.focus();
    await page.keyboard.press(TOGGLE_TAB_FOCUS);
    await page.keyboard.press('Tab');
    assert(!await focused(), `${label}: Tab moves focus while tab focus mode is on`);
    await content.focus();
    await page.keyboard.press(TOGGLE_TAB_FOCUS);
    await caretAt(1);
    await page.keyboard.press('Tab');
    assert(await focused(), `${label}: turning tab focus mode off makes Tab indent again`);
    assert.equal((await text()).split('\n')[0], '\tsite.test {', label);
    await undoAll();
}

test('the Caddyfile and route editors share indentation, bracket completion, folding and a way out', { timeout: 150000 }, async t => {
    const { stack, page, origin, waitForView } = await useBrowserFixture(t);
    const original = (await stack.api('/caddyfile')).data;

    // Opening the editor leaves the file exactly as loaded
    await page.goto(origin + '/caddyfile', { waitUntil: 'domcontentloaded' });
    await waitForView('.cm-editor');
    const editor = page.locator('.editor-wrap');
    assert.equal(await editor.locator('.cm-line').evaluateAll(lines => lines.map(line => line.textContent).join('\n')), original, 'The editor shows the file exactly as loaded');
    await editor.locator('.editor-hint--desktop').filter({ hasText: en.caddyfile.upToDate }).waitFor();
    // Folding the loaded file changes nothing to save
    await editor.locator(`.cm-foldGutter [title="${en.caddyfile.foldBlock}"]`).filter({ visible: true }).first().click();
    await editor.locator('.cm-foldPlaceholder').waitFor();
    assert.equal((await editor.locator('.editor-hint--desktop').innerText()).trim(), en.caddyfile.upToDate, 'Folding is not an edit');
    await editor.locator(`.cm-foldGutter [title="${en.caddyfile.unfoldBlock}"]`).filter({ visible: true }).first().click();
    await exerciseEditor(page, editor, 'Caddyfile editor');
    await exerciseFolding(page, editor, 'Caddyfile editor');
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.insertText(original);
    await editor.locator('.editor-hint--desktop').filter({ hasText: en.caddyfile.upToDate }).waitFor();

    // A Caddyfile site block, which the route modal edits as text (admin API routes have no block)
    const withSite = `${original.trimEnd()}\n\neditor-keys.test {\n\treverse_proxy 127.0.0.1:9\n}\n`;
    const saved = await stack.api('/caddyfile?fmt=false&sort=false', { method: 'PUT', body: withSite, plain: true });
    assert.equal(saved.status, 200, JSON.stringify(saved.data));
    await page.goto(origin + '/routes', { waitUntil: 'domcontentloaded' });
    await waitForView('tr:has-text("editor-keys.test")');
    await page.locator('tr').filter({ hasText: 'editor-keys.test' }).getByTitle(en.routes.editRoute).click();
    const modal = page.locator('.modal').filter({ hasText: en.routes.editRoute });
    await modal.locator('.cm-editor').waitFor();
    await exerciseEditor(page, modal, 'Route editor');
    await exerciseFolding(page, modal, 'Route editor');
    assert(await modal.isVisible(), 'Escape in the route editor does not close its modal');
    await modal.getByRole('button', { name: en.common.close, exact: true }).click();
    await modal.waitFor({ state: 'detached' });
    assert.equal((await stack.api('/caddyfile')).data, withSite, 'Nothing was saved');
});

test('route autocomplete uses the complete site block returned by the backend', { timeout: 90000 }, async t => {
    const { stack, page, origin, waitForView } = await useBrowserFixture(t);
    const original = (await stack.api('/caddyfile')).data;
    const withSite = `${original.trimEnd()}\n\nautocomplete.test {\n\t\n\treverse_proxy 127.0.0.1:9\n}\n`;
    const saved = await stack.api('/caddyfile?fmt=false&sort=false', { method: 'PUT', body: withSite, plain: true });
    assert.equal(saved.status, 200, JSON.stringify(saved.data));

    await page.goto(origin + '/routes', { waitUntil: 'domcontentloaded' });
    await waitForView('tr:has-text("autocomplete.test")');
    await page.locator('tr').filter({ hasText: 'autocomplete.test' }).getByTitle(en.routes.editRoute).click();
    const modal = page.locator('.modal').filter({ hasText: en.routes.editRoute });
    await modal.locator('.cm-editor').waitFor();
    assert.match(await visibleText(modal), /^autocomplete\.test \{\n/);

    await modal.locator('.cm-content').focus();
    await page.keyboard.press('ControlOrMeta+Home');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('End');
    await page.keyboard.type('re');
    await modal.getByRole('option', { name: 'reverse_proxy', exact: true }).click();
    assert.equal((await visibleText(modal)).split('\n')[1], '\treverse_proxy', 'The completion inserts a directive in the site body');

    await modal.getByRole('button', { name: en.common.close, exact: true }).click();
    assert.equal((await stack.api('/caddyfile')).data, withSite, 'Completing a directive does not save the route');
});

test('explicit autocomplete only offers names at directive positions', { timeout: 90000 }, async t => {
    const { stack, page, origin, waitForView } = await useBrowserFixture(t);
    const original = (await stack.api('/caddyfile')).data;
    await page.goto(origin + '/caddyfile', { waitUntil: 'domcontentloaded' });
    await waitForView('.cm-editor');
    const editor = page.locator('.editor-wrap');
    await page.clock.install();

    async function completeAfter(line) {
        await editor.locator('.cm-content').focus();
        await page.keyboard.press('ControlOrMeta+a');
        await page.keyboard.insertText(`autocomplete.test {\n${line}\n}`);
        await page.keyboard.press('ControlOrMeta+Home');
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('End');
        await page.keyboard.press('Control+Space');
        // Advance CodeMirror's completion timers before asserting absence.
        await page.clock.runFor(500);
    }

    for (const line of ['\t', '\tre']) {
        await completeAfter(line);
        assert.equal(await editor.getByRole('option', { name: 'reverse_proxy', exact: true }).count(), 1, 'Blank and partially typed directive names still complete');
        await page.keyboard.press('Escape');
    }
    for (const line of ['\tencode ', '\tencode gz', '\tencode gzip ', '\t@']) {
        await completeAfter(line);
        assert.equal(await editor.locator('.cm-tooltip-autocomplete').count(), 0, `No directive completions after ${JSON.stringify(line)}`);
    }
    assert.equal((await stack.api('/caddyfile')).data, original, 'Requesting completions does not save the Caddyfile');
});
