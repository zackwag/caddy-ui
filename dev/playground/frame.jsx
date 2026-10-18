import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { EditorView } from '@codemirror/view';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../src/frontend/src/i18n/index.js';
import { css, THEME_LIST } from '../../src/frontend/src/styles.js';
import FixtureView from './fixtures.jsx';
import { capture, scenarios } from './registry.jsx';
import { createReplayFetch } from './capture-format.js';
import { markReferences } from './dom-context.js';
import { placeholders, readValue } from './model.js';

const modules = import.meta.glob('../../src/frontend/src/i18n/locales/*.js', { eager: true, import: 'default' });
const catalogs = Object.fromEntries(Object.entries(modules).map(([path, catalog]) => [path.split('/').pop().slice(0, -3), catalog]));
const element = document.getElementById('root');
const root = createRoot(element, { onUncaughtError: error => send({ type: 'preview-error', message: error.message }) });
const realNow = Date.now;
const observations = new Map();
const misses = new Set();
let config;
let configuredState;
let setupStep = 0;
let queued = false;
let reportSignature = '';
let revision = 0;
let translations;
let disposed = false;

// React's autofocus remains local to the preview while someone types in the
// workbench. Pointer/keyboard interactions inside the frame still focus normally.
const focus = HTMLElement.prototype.focus;
function previewFocus(...args) {
    if (window.parent.document.activeElement?.matches('#translation, #key-search')) return;
    focus.apply(this, args);
}
HTMLElement.prototype.focus = previewFocus;

function send(message) { window.parent.postMessage({ channel: 'caddy-ui-playground', ...message }, location.origin); }

// A frame owns its API replay and production i18n singleton. Virtual storage
// prevents production components from reading or writing actual browser sessions.
for (const name of ['localStorage', 'sessionStorage']) {
    const values = new Map();
    Object.defineProperty(window, name, { configurable: true, value: {
        getItem: key => values.get(String(key)) ?? null,
        setItem: (key, value) => { values.set(String(key), String(value)); },
        removeItem: key => { values.delete(String(key)); }, clear: () => values.clear(),
        key: index => [...values.keys()][index] ?? null, get length() { return values.size; },
    } });
}

function miss(message) { misses.add(message); scheduleReport(); }
window.fetch = createReplayFetch([], miss, location.origin);
window.open = url => { miss(`Unrecorded window: ${String(url)}`); return null; };
for (const name of ['XMLHttpRequest', 'EventSource']) {
    window[name] = class { constructor() { miss(`Unrecorded transport: ${name}`); throw new Error(`Unrecorded transport: ${name}`); } };
}

i18n.options.react = { ...i18n.options.react, useSuspense: false, bindI18nStore: 'added removed' };
i18n.use({ type: 'postProcessor', name: 'playground-context', process(value, keys, options) {
    const key = Array.isArray(keys) ? keys[0] : keys;
    const details = i18n.t(key, { ...options, postProcess: [], returnDetails: true });
    const resolved = details.exactUsedKey || key;
    const reference = readValue(catalogs.en, resolved);
    if (typeof reference === 'string' && typeof value === 'string') {
        const parameters = Object.fromEntries(placeholders(reference).map(name => [name, options[name] ?? null]));
        observations.set(JSON.stringify([resolved, parameters]), { key: resolved, value, parameters });
    }
    return value;
} });
i18n.options.postProcess = ['playground-context'];

const style = document.createElement('style');
style.textContent = css + '\nbody { margin: 0; padding: 16px; min-height: 0; } [data-preview-key] { outline: 2px solid var(--accent); outline-offset: 3px; } [data-preview-ambiguous] { outline-style: dashed; }';
style.textContent += '\nbody[data-preview-kind="login"] { padding: 0; }';
document.head.append(style);

function scheduleReport() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
        queued = false;
        if (!config || disposed) return;
        const scenario = scenarios.find(scenario => scenario.id === config.scenario);
        if (!setupStep && ['edit-label', 'label-saved'].includes(scenario.setup)) {
            const edit = element.querySelector('.server-edit-icon');
            if (edit) { setupStep = 1; edit.click(); }
        } else if (setupStep === 1 && scenario.setup === 'label-saved') {
            const save = element.querySelector('.modal .btn-primary');
            if (save) { setupStep = 2; save.click(); }
        } else if (!setupStep && scenario.setup === 'route-add') {
            const add = element.querySelector('.routes-toolbar-actions > .btn-primary');
            if (add) { setupStep = 1; add.click(); }
        } else if (!setupStep && scenario.setup === 'route-columns') {
            const trigger = element.querySelector('.col-picker-trigger');
            if (trigger) { setupStep = 1; trigger.click(); }
        } else if (setupStep === 1 && scenario.setup === 'route-columns') {
            const id = element.querySelector('.col-picker-item:last-of-type input');
            if (id) { setupStep = 2; id.click(); }
        } else if (!setupStep && scenario.setup === 'tls-filter') {
            const card = element.querySelectorAll('.grid-4 .card-clickable')[scenario.filterIndex];
            if (card) { setupStep = 1; card.click(); }
        } else if (!setupStep && scenario.setup === 'welcome-light') {
            const light = element.querySelector('.modal .btn-ghost');
            if (light) { setupStep = 1; light.click(); }
        } else if (!setupStep && scenario.setup === 'theme-menu') {
            const trigger = element.querySelector('button.theme-picker-trigger');
            if (trigger) { setupStep = 1; trigger.click(); }
        } else if (!setupStep && ['observability-config', 'logs-enabled'].includes(scenario.setup)) {
            const header = element.querySelector('.card-header--clickable');
            if (header) { setupStep = 1; header.click(); }
        } else if (setupStep === 1 && scenario.setup === 'logs-enabled') {
            const toggle = element.querySelector('.log-enabled-btn');
            if (toggle) { setupStep = 2; toggle.click(); }
        } else if (!setupStep && scenario.kind === 'notification-settings') {
            const provider = element.querySelector('select.config-select');
            const toggle = element.querySelector('.notifications-enabled-btn');
            if (provider && toggle) {
                setupStep = 1;
                // Prepare the production form through its real change handlers.
                // The only recorded response is the untouched disabled default.
                provider.value = scenario.provider;
                provider.dispatchEvent(new Event('change', { bubbles: true }));
                if (scenario.enabled) toggle.click();
            }
        }
        if (!setupStep && scenario.setup === 'tls-orphaned') {
            const orphaned = element.querySelector('.card-header .btn-row > .section-label');
            if (orphaned) { setupStep = 1; orphaned.click(); }
        }
        if (scenario.kind === 'instances') {
            if (!setupStep && ['instance-add', 'instance-invalid', 'instance-edit', 'instance-remove', 'instance-discover'].includes(scenario.setup)) {
                const header = element.querySelector('.gap-16 > .card:first-child');
                const instance = element.querySelector('.instance-details-grid')?.closest('.card');
                const action = scenario.setup === 'instance-edit' ? instance?.querySelector('.btn-ghost')
                    : scenario.setup === 'instance-remove' ? instance?.querySelector('.btn-danger')
                        : scenario.setup === 'instance-discover' ? header?.querySelector('.btn-ghost') : header?.querySelector('.btn-primary');
                if (action) { setupStep = 1; action.click(); }
            } else if (setupStep === 1 && scenario.setup === 'instance-invalid') {
                const save = element.querySelector('.modal .btn-primary');
                if (save) { setupStep = 2; save.click(); }
            }
        }
        if (!setupStep && scenario.setup === 'route-edit') {
            const edit = element.querySelector('.col-actions button[title]:last-of-type');
            if (edit) { setupStep = 1; edit.click(); }
        }
        if (scenario.kind === 'caddyfile') {
            const buttons = [...element.querySelectorAll('.editor-toolbar-actions > button')];
            const historySetups = ['caddyfile-history', 'caddyfile-list', 'caddyfile-diff', 'caddyfile-raw', 'caddyfile-restore', 'caddyfile-delete'];
            if (!setupStep && historySetups.includes(scenario.setup) && buttons[1]) { setupStep = 1; buttons[1].click(); }
            else if (setupStep === 1 && ['caddyfile-list', 'caddyfile-diff'].includes(scenario.setup)) {
                const list = element.querySelector('[aria-controls="history-version-list"]');
                if (list) { setupStep = 2; list.click(); }
            } else if (setupStep === 2 && scenario.setup === 'caddyfile-diff') {
                const entries = element.querySelectorAll('.history-entry');
                if (entries.length >= 2) { setupStep = 3; entries[entries.length - 1].click(); }
            } else if (setupStep === 1 && scenario.setup === 'caddyfile-raw') {
                const raw = element.querySelector('.history-range-picker button:last-child');
                if (raw) { setupStep = 2; raw.click(); }
            } else if (setupStep === 1 && ['caddyfile-restore', 'caddyfile-delete'].includes(scenario.setup)) {
                const action = element.querySelectorAll('.history-version-actions button')[scenario.setup === 'caddyfile-restore' ? 0 : 1];
                if (action && !action.disabled) { setupStep = 2; action.click(); }
            } else if (!setupStep && scenario.setup === 'caddyfile-force') {
                const editor = element.querySelector('.cm-content');
                if (editor) {
                    setupStep = 1;
                    // Use the production editor's transaction/update listener;
                    // leave focus in the contributor's translation input.
                    const view = EditorView.findFromDOM(editor);
                    view.dispatch({ changes: { from: view.state.doc.length, insert: '\n# Local playground edit\n' } });
                }
            } else if (setupStep === 1 && scenario.setup === 'caddyfile-force' && buttons[5] && !buttons[5].disabled) {
                setupStep = 2; buttons[5].click();
            } else if (!setupStep && scenario.setup === 'caddyfile-import') {
                const input = element.querySelector('input[type="file"]');
                if (input) {
                    setupStep = 1;
                    const data = new DataTransfer();
                    data.items.add(new File(['# Local playground import\n'], 'Caddyfile', { type: 'text/plain' }));
                    input.files = data.files;
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                }
            } else if (!setupStep && scenario.setup === 'caddyfile-valid' && buttons[0]) {
                setupStep = 1; buttons[0].click();
            }
        }
        const records = [...observations.values()];
        const references = markReferences(element, config.selected, records);
        // Login fills the viewport. Measuring its shell and then adding padding
        // would grow the iframe indefinitely; size it from the actual card.
        const content = scenario.kind === 'login' ? element.querySelector('.login-card') : element;
        const report = { type: 'preview-report', scenario: scenario.id, references,
            selected: config.selected, locale: config.locale,
            observations: records, misses: [...misses], height: Math.max(scenario.kind === 'dashboard' ? 300 : 260,
                Math.ceil((content?.getBoundingClientRect().height || 0) + 32),
                ...[...element.querySelectorAll('.modal, .toast-wrap')].map(element => Math.ceil(element.getBoundingClientRect().height + 32)),
                ...[...element.querySelectorAll('.theme-picker-menu')].map(element => Math.ceil(element.getBoundingClientRect().bottom + 16))) };
        const signature = JSON.stringify(report);
        if (signature !== reportSignature) { reportSignature = signature; send(report); }
    });
}

const mutations = new MutationObserver(scheduleReport);
mutations.observe(element, { subtree: true, childList: true, characterData: true,
    attributes: true, attributeFilter: ['title', 'placeholder', 'aria-label', 'aria-valuetext'] });
const sizes = new ResizeObserver(scheduleReport);
sizes.observe(element);

async function configurePreview(event) {
    if (event.source !== window.parent || event.origin !== location.origin ||
        event.data?.channel !== 'caddy-ui-playground' || event.data.type !== 'configure-preview') return;
    const next = event.data.config;
    const scenario = scenarios.find(scenario => scenario.id === next?.scenario);
    if (!scenario || !Object.hasOwn(catalogs, next.locale) || typeof readValue(catalogs.en, next.selected) !== 'string') return;
    const profile = capture.scenarios.find(profile => profile.id === scenario.profile);
    // History queries contain an exact since=<epoch>. Replay its observed clock
    // so production range controls keep using the captured request URLs.
    Date.now = profile?.clock === undefined ? realNow : () => profile.clock;
    const currentRevision = ++revision;
    config = next;
    const translationKey = JSON.stringify([next.locale, next.overrides]);
    if (translations !== translationKey) { observations.clear(); translations = translationKey; }
    // Login's session-expired message, like the saved-label toast, is translated
    // on mount. Recreate it when drafts or locale change to avoid stale wording.
    const stateKey = scenario.setup === 'label-saved' || scenario.remountOnTranslation
        ? JSON.stringify([scenario.id, next.locale, next.overrides]) : scenario.id;
    if (configuredState !== stateKey) {
        misses.clear(); observations.clear(); setupStep = 0;
        const records = [...(profile?.requests || []), ...(capture.csrfContext ? [capture.csrfContext.record] : [])];
        window.fetch = createReplayFetch(records, miss, location.origin);
        configuredState = stateKey;
    }
    const palette = THEME_LIST.find(theme => theme.id === (next.light ? 'coarse-everywhere' : 'vt2026'));
    for (const [key, value] of Object.entries(palette.vars)) document.documentElement.style.setProperty(key, value);
    for (const [locale, catalog] of Object.entries(catalogs)) {
        i18n.removeResourceBundle(locale, 'translation');
        i18n.addResourceBundle(locale, 'translation', structuredClone(catalog));
    }
    for (const [key, value] of Object.entries(next.overrides)) {
        if (typeof readValue(catalogs.en, key) === 'string' && typeof value === 'string') i18n.addResource(next.locale, 'translation', key, value);
    }
    await i18n.changeLanguage(next.locale);
    if (disposed || currentRevision !== revision) return;
    document.documentElement.lang = next.locale;
    document.body.dataset.previewKind = scenario.kind;
    flushSync(() => root.render(<MemoryRouter key={stateKey} initialEntries={[scenario.path || '/dashboard']}>
        <I18nextProvider i18n={i18n}><FixtureView scenario={scenario} /></I18nextProvider>
    </MemoryRouter>));
    scheduleReport();
}
window.addEventListener('message', configurePreview);
import.meta.hot?.dispose(() => {
    disposed = true;
    mutations.disconnect(); sizes.disconnect();
    window.removeEventListener('message', configurePreview);
    root.unmount(); style.remove();
    Date.now = realNow;
    if (HTMLElement.prototype.focus === previewFocus) HTMLElement.prototype.focus = focus;
    // Keep virtual storage/replay in place until the next module initializes.
});
send({ type: 'preview-ready' });
