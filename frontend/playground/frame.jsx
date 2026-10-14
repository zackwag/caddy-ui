import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18n from '../src/i18n/index.js';
import { css, THEME_LIST } from '../src/styles.js';
import FixtureView from './fixtures.jsx';
import { capture, scenarios } from './registry.jsx';
import { createReplayFetch } from './capture-format.js';
import { markReferences } from './dom-context.js';
import { placeholders, readValue } from './model.js';

const modules = import.meta.glob('../src/i18n/locales/*.js', { eager: true, import: 'default' });
const catalogs = Object.fromEntries(Object.entries(modules).map(([path, catalog]) => [path.split('/').pop().slice(0, -3), catalog]));
const element = document.getElementById('root');
const root = createRoot(element, { onUncaughtError: error => send({ type: 'preview-error', message: error.message }) });
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
        }
        const records = [...observations.values()];
        const references = markReferences(element, config.selected, records);
        const report = { type: 'preview-report', scenario: scenario.id, references,
            selected: config.selected, locale: config.locale,
            observations: records, misses: [...misses], height: Math.max(scenario.kind === 'dashboard' ? 300 : 260,
                Math.ceil(element.getBoundingClientRect().height + 32),
                ...[...element.querySelectorAll('.modal, .toast-wrap')].map(element => Math.ceil(element.getBoundingClientRect().height + 32))) };
        const signature = JSON.stringify(report);
        if (signature !== reportSignature) { reportSignature = signature; send(report); }
    });
}

const mutations = new MutationObserver(scheduleReport);
mutations.observe(element, { subtree: true, childList: true, characterData: true,
    attributes: true, attributeFilter: ['title', 'placeholder', 'aria-label'] });
const sizes = new ResizeObserver(scheduleReport);
sizes.observe(element);

async function configurePreview(event) {
    if (event.source !== window.parent || event.origin !== location.origin ||
        event.data?.channel !== 'caddy-ui-playground' || event.data.type !== 'configure-preview') return;
    const next = event.data.config;
    const scenario = scenarios.find(scenario => scenario.id === next?.scenario);
    if (!scenario || !Object.hasOwn(catalogs, next.locale) || typeof readValue(catalogs.en, next.selected) !== 'string') return;
    const currentRevision = ++revision;
    config = next;
    const translationKey = JSON.stringify([next.locale, next.overrides]);
    if (translations !== translationKey) { observations.clear(); translations = translationKey; }
    const stateKey = scenario.setup === 'label-saved' ? JSON.stringify([scenario.id, next.locale, next.overrides]) : scenario.id;
    if (configuredState !== stateKey) {
        misses.clear(); observations.clear(); setupStep = 0;
        const profile = capture.scenarios.find(profile => profile.id === scenario.profile);
        window.fetch = createReplayFetch(profile?.requests || [], miss, location.origin);
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
    flushSync(() => root.render(<MemoryRouter key={stateKey} initialEntries={['/dashboard']}>
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
    if (HTMLElement.prototype.focus === previewFocus) HTMLElement.prototype.focus = focus;
    // Keep virtual storage/replay in place until the next module initializes.
});
send({ type: 'preview-ready' });
