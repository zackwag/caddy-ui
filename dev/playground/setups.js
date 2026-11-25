import { EditorView } from '@codemirror/view';

// How a scenario's state is reached through the production UI: steps named by
// its `setup`, each tried again whenever the UI changes until it returns true.

function press(control) {
    if (!control || control.disabled) return false;
    control.click();
    return true;
}

const click = selector => root => press(root.querySelector(selector));
const toolbarButton = index => root => press(root.querySelectorAll('.editor-toolbar-actions > button')[index]);

const openLabel = click('.server-edit-icon');
const openConfiguration = click('.card-header--clickable');
const addInstance = root => press(root.querySelector('.gap-16 > .card:first-child')?.querySelector('.btn-primary'));
const instanceButton = selector => root => press(root.querySelector('.instance-details-grid')?.closest('.card').querySelector(selector));
const [validate, openHistory, forceSave] = [0, 1, 5].map(toolbarButton);
const openVersionList = click('[aria-controls="history-version-list"]');
const versionAction = index => root => press(root.querySelectorAll('.history-version-actions button')[index]);

function chooseProvider(root, { provider, enabled }) {
    const select = root.querySelector('select.config-select');
    const toggle = root.querySelector('.notifications-enabled-btn');
    if (!select || !toggle) return false;
    // The only recorded response is the untouched disabled default.
    select.value = provider;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    if (enabled) toggle.click();
    return true;
}

// Uses the editor's own update listener, leaving focus in the contributor's
// translation input.
function editCaddyfile(root) {
    const editor = root.querySelector('.cm-content');
    if (!editor) return false;
    const view = EditorView.findFromDOM(editor);
    view.dispatch({ changes: { from: view.state.doc.length, insert: '\n# Local playground edit\n' } });
    return true;
}

function importCaddyfile(root) {
    const input = root.querySelector('input[type="file"]');
    if (!input) return false;
    const data = new DataTransfer();
    data.items.add(new File(['# Local playground import\n'], 'Caddyfile', { type: 'text/plain' }));
    input.files = data.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
}

function oldestVersion(root) {
    const entries = root.querySelectorAll('.history-entry');
    return entries.length >= 2 && press(entries[entries.length - 1]);
}

export const setups = {
    'edit-label': [openLabel],
    'label-saved': [openLabel, click('.modal .btn-primary')],
    'route-add': [click('.routes-toolbar-actions > .btn-primary')],
    'route-columns': [click('.col-picker-trigger'), click('.col-picker-item:last-of-type input')],
    'route-edit': [click('.col-actions button[title]:last-of-type')],
    'tls-filter': [(root, { filterIndex }) => press(root.querySelectorAll('.grid-4 .card-clickable')[filterIndex])],
    'tls-orphaned': [click('.card-header .btn-row > .section-label')],
    'welcome-light': [click('.modal .btn-ghost')],
    'theme-menu': [click('button.theme-picker-trigger')],
    'observability-config': [openConfiguration],
    'logs-enabled': [openConfiguration, click('.log-enabled-btn')],
    'notification-provider': [chooseProvider],
    'instance-add': [addInstance],
    'instance-invalid': [addInstance, click('.modal .btn-primary')],
    'instance-edit': [instanceButton('.btn-ghost')],
    'instance-remove': [instanceButton('.btn-danger')],
    'instance-discover': [root => press(root.querySelector('.gap-16 > .card:first-child')?.querySelector('.btn-ghost'))],
    'caddyfile-history': [openHistory],
    'caddyfile-list': [openHistory, openVersionList],
    'caddyfile-diff': [openHistory, openVersionList, oldestVersion],
    'caddyfile-raw': [openHistory, click('.history-range-picker button:last-child')],
    'caddyfile-restore': [openHistory, versionAction(0)],
    'caddyfile-delete': [openHistory, versionAction(1)],
    'caddyfile-force': [editCaddyfile, forceSave],
    'caddyfile-import': [importCaddyfile],
    'caddyfile-valid': [validate],
};
