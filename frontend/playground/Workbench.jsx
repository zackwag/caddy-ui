import { useState } from 'react';
import { I18nextProvider } from 'react-i18next';
import { flattenCatalog, placeholders, readValue } from './model.js';
import { scenarios } from './registry.jsx';

export default function Workbench({ catalogs, preview }) {
    const [locale, setLocale] = useState('de' in catalogs ? 'de' : 'en');
    const [selected, setSelected] = useState('common.delete');
    const [query, setQuery] = useState('');
    const [drafts, setDrafts] = useState({});
    const [copyStatus, setCopyStatus] = useState('');
    const [light, setLight] = useState(false);
    const entries = flattenCatalog(catalogs.en);
    const english = readValue(catalogs.en, selected);
    const saved = readValue(catalogs[locale], selected);
    const overrides = drafts[locale] || {};
    const draft = overrides[selected] ?? saved ?? english;
    const matching = scenarios.filter(scenario => scenario.keys.includes(selected));
    const filtered = entries.filter(([key, value]) => `${key} ${value} ${readValue(catalogs[locale], key) || ''}`.toLowerCase().includes(query.toLowerCase()));
    const mismatch = JSON.stringify(placeholders(english)) !== JSON.stringify(placeholders(draft));

    function chooseLocale(code) {
        setLocale(code);
        setCopyStatus('');
        preview.changeLanguage(code);
    }

    function edit(value) {
        setCopyStatus('');
        setDrafts(current => ({ ...current, [locale]: { ...current[locale], [selected]: value } }));
        preview.addResource(locale, 'translation', selected, value);
    }

    function reset() {
        setCopyStatus('');
        setDrafts(current => {
            const next = { ...current[locale] };
            delete next[selected];
            return { ...current, [locale]: next };
        });
        // Rebuild from the saved catalog so missing keys retain genuine fallback.
        preview.removeResourceBundle(locale, 'translation');
        preview.addResourceBundle(locale, 'translation', structuredClone(catalogs[locale]));
        for (const [key, value] of Object.entries(overrides)) {
            if (key !== selected) preview.addResource(locale, 'translation', key, value);
        }
    }

    async function copy(value) {
        try {
            await navigator.clipboard.writeText(value);
            setCopyStatus('Copied');
        } catch {
            setCopyStatus('Clipboard unavailable. Select and copy the editor text manually.');
        }
    }

    return <main className={`workbench ${light ? 'light' : ''}`}>
        <header><div><h1>Localization playground</h1><p>Preview only — edits stay in memory. No files are modified.</p></div>
            <label>Language <select value={locale} onChange={event => chooseLocale(event.target.value)}>{Object.keys(catalogs).map(code => <option key={code}>{code}</option>)}</select></label>
            <button onClick={() => setLight(!light)}>{light ? 'Dark' : 'Light'} previews</button>
        </header>
        <div className="workspace">
            <aside><label htmlFor="key-search">Search keys and translations</label><input id="key-search" value={query} onChange={event => setQuery(event.target.value)} />
                <p>{filtered.length} / {entries.length} keys · {new Set(scenarios.flatMap(s => s.keys)).size} with previews</p>
                <nav aria-label="Translation keys">{filtered.map(([key]) => <button key={key} aria-pressed={selected === key} onClick={() => { setSelected(key); setCopyStatus(''); }}>{key}{readValue(catalogs[locale], key) === undefined && <small> English fallback</small>}</button>)}</nav>
            </aside>
            <section className="detail"><h2>{selected}</h2>
                <div className="gallery"><I18nextProvider i18n={preview}>{matching.map(({ id, title, Component }) => <article key={id}><h3>{title}</h3><div className="fixture"><Component /></div></article>)}</I18nextProvider>
                    {!matching.length && <p className="empty">No component fixture registered for this key yet. You can still inspect and edit its value below.</p>}
                </div>
                <div className="editors"><section><h3>English reference</h3><pre>{english}</pre></section><section><h3>Saved {locale}</h3><pre>{saved ?? 'Missing — falls back to English'}</pre></section></div>
                <label htmlFor="translation">Try translation</label><textarea id="translation" value={draft} onChange={event => edit(event.target.value)} rows={4} />
                {mismatch && <p role="alert">Interpolation placeholders differ from English. Preserve: {placeholders(english).join(', ') || '(none)'}</p>}
                <div className="actions"><button onClick={() => copy(draft)}>Copy value</button><button onClick={() => copy(selected)}>Copy key</button><button onClick={reset}>Reset this key</button><span role="status">{copyStatus}</span></div>
            </section>
        </div>
    </main>;
}
