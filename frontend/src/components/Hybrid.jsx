import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../utils/api.js';
import { localizeError } from '../utils/errorMessages.js';
import { certificateProblem, filterHybridSites, validateHybridSite } from '../utils/hybrid.js';
import './Hybrid.css';

const EMPTY_FORM = { domain: '', upstream: '', certificate: '' };
const STATUS_COLORS = { applied: 'green', pending: 'yellow', 'label-conflict': 'red', unknown: 'muted', labels: 'blue' };
const STATUS_KEYS = { applied: 'hybrid.applied', pending: 'hybrid.pending', 'label-conflict': 'hybrid.conflict', unknown: 'hybrid.unknown', labels: 'hybrid.external' };
const MAX_UPLOAD_BYTES = 1024 * 1024;
const SOURCE_FILTERS = ['all', 'manual', 'labels'];
const FIRST_FOCUSABLE = 'input:not(:disabled), button:not(:disabled)';
const FOCUSABLE = 'button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]';
const FILE_TOO_LARGE = 'hybrid.fileTooLarge';
const FILE_READ_ERROR = 'hybrid.fileReadError';
const IMPORTED = 'hybrid.imported';
const CERTIFICATE_SOURCES = ['configured', 'imported', 'acme', 'internal'];
const MANAGED_SOURCES = ['acme', 'internal'];
const CERTIFICATE_SOURCE_KEYS = { configured: 'hybrid.configuredCertificates', imported: 'hybrid.uploadedCertificates', acme: 'hybrid.managedCertificates', internal: 'hybrid.internalCertificates' };
// eslint-disable-next-line i18next/no-literal-string -- Example hostname, not interface copy.
const DOMAIN_EXAMPLE = 'app.example.com';
// eslint-disable-next-line i18next/no-literal-string -- Example container address.
const UPSTREAM_EXAMPLE = 'my-app:8080';

function HybridDialog({ title, busy, onClose, children }) {
    const ref = useRef(null);
    useEffect(() => {
        const previous = document.activeElement;
        ref.current?.querySelector(FIRST_FOCUSABLE)?.focus();
        return () => previous?.focus();
    }, []);
    function onKeyDown(event) {
        if (event.key === 'Escape' && !busy) onClose();
        if (event.key !== 'Tab') return;
        const elements = [...ref.current.querySelectorAll(FOCUSABLE)];
        const first = elements[0];
        const last = elements.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
    return <div className="modal-overlay" onClick={() => { if (!busy) onClose(); }}>
        <div ref={ref} className="modal hybrid-modal" role="dialog" aria-modal="true" aria-labelledby="hybrid-dialog-title" onClick={e => e.stopPropagation()} onKeyDown={onKeyDown}>
            <h2 className="modal-title" id="hybrid-dialog-title">{title}</h2>
            {children}
        </div>
    </div>;
}

export default function Hybrid({ onUnauth }) {
    const { t } = useTranslation();
    const [data, setData] = useState(null);
    const [loadError, setLoadError] = useState(null);
    const [actionError, setActionError] = useState(null);
    const [validation, setValidation] = useState('');
    const [message, setMessage] = useState('');
    const [busy, setBusy] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const [dialog, setDialog] = useState(null);
    const [search, setSearch] = useState('');
    const [source, setSource] = useState('all');
    const [form, setForm] = useState(EMPTY_FORM);
    const [certificate, setCertificate] = useState(null);
    const [privateKey, setPrivateKey] = useState(null);
    const request = useRef({ sequence: 0 });

    const refresh = useCallback(async () => {
        const id = ++request.current.sequence;
        setRefreshing(true);
        try {
            const next = await apiFetch('/hybrid', {}, onUnauth);
            if (id === request.current.sequence) { setData(next); setLoadError(null); }
        } catch (error) {
            if (id === request.current.sequence) setLoadError(error);
        } finally {
            if (id === request.current.sequence) setRefreshing(false);
        }
    }, [onUnauth]);

    useEffect(() => {
        const counter = request.current;
        refresh();
        const timer = setInterval(refresh, 5000);
        return () => { clearInterval(timer); ++counter.sequence; };
    }, [refresh]);

    function openDialog(next, site = EMPTY_FORM) {
        setActionError(null); setValidation(''); setForm(site);
        setCertificate(null); setPrivateKey(null); setDialog(next);
    }

    async function action(path, method, body, successKey = 'hybrid.pendingHelp') {
        setBusy(true); setActionError(null); setValidation(''); setMessage('');
        try {
            await apiFetch(path, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }, onUnauth);
            setMessage(successKey); setDialog(null);
            setCertificate(null); setPrivateKey(null);
            await refresh();
        } catch (error) { setActionError(error); }
        finally { setBusy(false); }
    }

    async function saveSite(event) {
        event.preventDefault();
        const site = { domain: form.domain.trim().toLowerCase(), upstream: form.upstream.trim(), certificate: form.certificate || '' };
        const problem = validateHybridSite(site, data?.labels || []) || (site.certificate && certificateProblem(certificates.find(cert => cert.id === site.certificate), site.domain));
        if (problem) { setValidation(problem); return; }
        await action('/hybrid/sites', 'POST', site);
    }

    async function importCertificate(event) {
        event.preventDefault();
        if (!certificate || !privateKey) return;
        if (certificate.size > MAX_UPLOAD_BYTES || privateKey.size > MAX_UPLOAD_BYTES) { setValidation(FILE_TOO_LARGE); return; }
        setBusy(true); setActionError(null); setValidation('');
        try {
            const [pem, key] = await Promise.all([certificate.text(), privateKey.text()]);
            await action('/hybrid/certificates', 'POST', { certificate: pem, privateKey: key }, IMPORTED);
        } catch { setValidation(FILE_READ_ERROR); }
        finally { setBusy(false); }
    }

    const sites = filterHybridSites(data, search, source);
    const certificates = data?.certificates || [];
    const selectedCertificate = certificates.find(cert => cert.id === form.certificate);
    const selectionProblem = form.certificate ? certificateProblem(selectedCertificate, form.domain) : '';
    const managedSelection = MANAGED_SOURCES.includes(selectedCertificate?.source);
    const formError = validation ? t(validation) : actionError ? localizeError(actionError, t) : '';
    const setField = field => event => setForm(current => ({ ...current, [field]: event.target.value }));

    return <section className="hybrid-page gap-16" aria-label={t('hybrid.title')}>
        <div className="hybrid-intro">
            <div className="hybrid-intro-icon" aria-hidden="true">⇄</div>
            <div><h2>{t('hybrid.manageTogether')}</h2><p>{t('hybrid.help')}</p></div>
        </div>
        {loadError && <div className="hybrid-notice hybrid-notice-error" role="alert">
            <span>{localizeError(loadError, t)} {data ? t('hybrid.staleData') : ''}</span>
            <button className="btn btn-ghost" disabled={refreshing} onClick={refresh}>{t('common.refresh')}</button>
        </div>}
        {message && <div className="hybrid-notice hybrid-notice-success" role="status">{t(message)}</div>}
        <div className="flex-between routes-toolbar">
            <div className="search-wrap hybrid-search">
                <input className="search-input search-input--clearable" aria-label={t('hybrid.search')} placeholder={t('hybrid.search')} value={search} onChange={e => setSearch(e.target.value)} />
                {search && <button className="search-clear" onClick={() => setSearch('')} title={t('common.clearSearch')} aria-label={t('common.clearSearch')}>✕</button>}
            </div>
            <div className="btn-row routes-toolbar-actions">
                <button className="btn btn-ghost" onClick={refresh} disabled={refreshing}>↻ {t('common.refresh')}</button>
                <button className="btn btn-primary" disabled={!data || !!loadError || busy} onClick={() => openDialog('add')}>+ {t('routes.addRoute')}</button>
            </div>
        </div>
        <div className="card card-flush">
            <div className="hybrid-table-heading">
                <div className="hybrid-filters" role="group" aria-label={t('hybrid.filterSource')}>
                    {SOURCE_FILTERS.map(value => <button key={value} className={`hybrid-filter${source === value ? ' is-active' : ''}`} aria-pressed={source === value} onClick={() => setSource(value)}>
                        {t({ all: 'hybrid.allSites', manual: 'hybrid.manualSource', labels: 'hybrid.labelsSource' }[value])}
                        {data && <span>{value === 'all' ? data.sites.length + data.labels.length : value === 'manual' ? data.sites.length : data.labels.length}</span>}
                    </button>)}
                </div>
                <span className="section-label">{t('hybrid.autoRefresh')}</span>
            </div>
            {!data ? <div className="card-empty" role="status">{t(loadError ? 'hybrid.loadFailed' : 'common.loading')}</div> : sites.length === 0 ? <div className="card-empty hybrid-empty">
                <span className="hybrid-empty-icon" aria-hidden="true">◇</span>
                <strong>{t(search ? 'hybrid.noMatches' : 'hybrid.noSites')}</strong>
                <p>{t(search ? 'hybrid.searchHelp' : 'hybrid.emptyHelp')}</p>
                {search && <button className="btn btn-ghost" onClick={() => setSearch('')}>{t('common.clearSearch')}</button>}
            </div> : <div className="table-wrap"><table className="table hybrid-table">
                <thead><tr><th scope="col">{t('routes.domain')}</th><th scope="col">{t('hybrid.source')}</th><th scope="col">{t('routes.upstream')}</th><th scope="col">{t('hybrid.status')}</th><th scope="col">{t('hybrid.actions')}</th></tr></thead>
                <tbody>{sites.map(site => <tr key={`${site.source}:${site.domain}`}>
                    <td><bdi className="mono hybrid-domain" dir="ltr">{site.domain}</bdi><div className="hybrid-row-detail">{site.source === 'manual' ? t(site.certificate && !MANAGED_SOURCES.includes(site.certificateSource) ? 'hybrid.customCertificate' : 'hybrid.automatic') : t('hybrid.labelManaged')}</div></td>
                    <td><span className={`badge badge-${site.source === 'manual' ? 'green' : 'blue'}`}>{t(site.source === 'manual' ? 'hybrid.manualSource' : 'hybrid.labelsSource')}</span></td>
                    <td>{site.upstream ? <bdi dir="ltr" className="mono hybrid-upstream">{site.upstream}</bdi> : <span className="cell-muted">{t('hybrid.fromLabels')}</span>}</td>
                    <td><span className={`badge badge-${STATUS_COLORS[site.status] || 'muted'}`} title={t(site.status === 'label-conflict' ? 'hybrid.conflictHelp' : site.status === 'pending' ? 'hybrid.pendingStatusHelp' : site.source === 'labels' ? 'hybrid.labelHelp' : 'hybrid.statusHelp')}>{t(STATUS_KEYS[site.status] || 'hybrid.unknown')}</span></td>
                    <td className="col-actions">{site.source === 'manual' ? <div className="btn-row flex-end">
                        <button className="btn btn-ghost btn--icon" disabled={busy || !!loadError} onClick={() => openDialog('edit', site)} title={t('hybrid.editSite', { domain: site.domain })} aria-label={t('hybrid.editSite', { domain: site.domain })}>✎</button>
                        <button className="btn btn-danger btn--icon" disabled={busy || !!loadError} onClick={() => openDialog('delete', site)} title={t('hybrid.deleteSite', { domain: site.domain })} aria-label={t('hybrid.deleteSite', { domain: site.domain })}>✕</button>
                    </div> : <span className="hybrid-readonly" title={t('hybrid.labelHelp')}>{t('hybrid.readOnly')}</span>}</td>
                </tr>)}</tbody>
            </table></div>}
            <p className="hybrid-table-note">{t('hybrid.labelHelp')}</p>
        </div>
        <div className="card hybrid-certificates">
            <div className="hybrid-certificate-heading">
                <div><h2>{t('hybrid.certificatesTitle')} <span className="badge badge-muted">{certificates.length}</span></h2><p>{t('hybrid.certificatesHelp')}</p></div>
                <button className="btn btn-ghost" disabled={!data || busy} onClick={() => openDialog('import')}>↑ {t('hybrid.upload')}</button>
            </div>
            {data?.certificateWarnings?.length > 0 && <p className="hybrid-notice hybrid-notice-error" role="alert">{t('hybrid.certificateDiscoveryWarning')}</p>}
            {certificates.length === 0 ? <p className="hybrid-certificate-empty">{t('hybrid.noCertificates')}</p> : <div className="hybrid-certificate-list">{certificates.map(cert => <article className="hybrid-certificate" key={cert.id}>
                <div className="hybrid-certificate-meta"><strong><bdi dir="ltr">{cert.names || cert.subject || cert.id}</bdi></strong><span className={`badge badge-${certificateProblem(cert, '') ? 'red' : cert.daysRemaining < 30 ? 'yellow' : 'green'}`}>{certificateProblem(cert, '') ? t(certificateProblem(cert, '')) : t('hybrid.expiry', { date: cert.validTo, days: cert.daysRemaining })}</span></div>
                <p className="hybrid-field-hint">{t(CERTIFICATE_SOURCE_KEYS[cert.source || 'imported'])}{cert.issuer ? <bdi dir="ltr"> · {cert.issuer}</bdi> : null}</p>
                {(!cert.source || cert.source === 'imported') && <details><summary>{t('hybrid.labelSnippet')}</summary><p>{t('hybrid.labelSnippetHelp')}</p><code dir="ltr">{`caddy.tls: "/hybrid/certs/${cert.id}/cert.pem /hybrid/certs/${cert.id}/key.pem"`}</code></details>}
            </article>)}</div>}
        </div>
        {dialog && <HybridDialog title={t(dialog === 'add' ? 'routes.newRoute' : dialog === 'edit' ? 'routes.editRoute' : dialog === 'delete' ? 'hybrid.deleteTitle' : 'hybrid.upload')} busy={busy} onClose={() => setDialog(null)}>
            {(dialog === 'add' || dialog === 'edit') && <form onSubmit={saveSite}>
                <p className="hybrid-form-intro">{t('hybrid.manualHelp')}</p>
                <div className="field"><label htmlFor="hybrid-domain">{t('routes.domain')}</label><input id="hybrid-domain" dir="ltr" autoComplete="off" required value={form.domain} disabled={dialog === 'edit' || busy} onChange={setField('domain')} placeholder={DOMAIN_EXAMPLE} aria-describedby="hybrid-domain-help" /><p className="hybrid-field-hint" id="hybrid-domain-help">{t(dialog === 'edit' ? 'hybrid.renameHelp' : 'hybrid.domainHelp')}</p></div>
                <div className="field"><label htmlFor="hybrid-upstream">{t('hybrid.upstream')}</label><input id="hybrid-upstream" dir="ltr" autoComplete="off" required value={form.upstream} disabled={busy} onChange={setField('upstream')} placeholder={UPSTREAM_EXAMPLE} aria-describedby="hybrid-network-help" /><p className="hybrid-field-hint" id="hybrid-network-help">{t('hybrid.networkHelp')}</p></div>
                <div className="field"><label htmlFor="hybrid-certificate">{t('hybrid.certificate')}</label><select id="hybrid-certificate" dir="ltr" value={form.certificate || ''} disabled={busy} onChange={setField('certificate')} aria-describedby="hybrid-certificate-help">
                    <option value="">{t('hybrid.automatic')}</option>
                    {form.certificate && !selectedCertificate && <option value={form.certificate} disabled>{t('hybrid.certificateUnavailable')}</option>}
                    {CERTIFICATE_SOURCES.map(source => {
                        const group = certificates.filter(cert => (cert.source || 'imported') === source);
                        return group.length > 0 && <optgroup key={source} label={t(CERTIFICATE_SOURCE_KEYS[source])}>{group.map(cert => {
                            const problem = certificateProblem(cert, form.domain);
                            return <option key={cert.id} value={cert.id} disabled={!!problem}>{cert.names || cert.subject || cert.id}{problem ? ` — ${t(problem)}` : ''}</option>;
                        })}</optgroup>;
                    })}
                </select><p className="hybrid-field-hint" id="hybrid-certificate-help">{t(managedSelection ? 'hybrid.managedCertificateHelp' : 'hybrid.certificateHelp')}</p>
                    {selectionProblem && <p className="hybrid-form-error" role="alert">{t(selectionProblem)}</p>}
                    {data?.certificateWarnings?.length > 0 && <p className="hybrid-form-error">{t('hybrid.certificateDiscoveryWarning')}</p>}
                </div>
                {formError && <p className="hybrid-form-error" role="alert">{formError}</p>}
                <div className="btn-row flex-end hybrid-form-actions"><button className="btn btn-ghost" type="button" disabled={busy} onClick={() => setDialog(null)}>{t('common.cancel')}</button><button className="btn btn-primary" disabled={busy || !!selectionProblem} type="submit">{t(busy ? 'common.saving' : 'common.save')}</button></div>
            </form>}
            {dialog === 'delete' && <form onSubmit={event => { event.preventDefault(); action(`/hybrid/sites/${encodeURIComponent(form.domain)}`, 'DELETE'); }}>
                <p className="hybrid-form-intro">{t('hybrid.confirmDelete', { domain: form.domain })}</p>
                {formError && <p className="hybrid-form-error" role="alert">{formError}</p>}
                <div className="btn-row flex-end hybrid-form-actions"><button className="btn btn-ghost" type="button" disabled={busy} onClick={() => setDialog(null)}>{t('common.cancel')}</button><button className="btn btn-danger" disabled={busy} type="submit">{t(busy ? 'hybrid.deleting' : 'common.delete')}</button></div>
            </form>}
            {dialog === 'import' && <form onSubmit={importCertificate}>
                <p className="hybrid-form-intro">{t('hybrid.keyHelp')}</p>
                <div className="field hybrid-file-field"><label htmlFor="hybrid-cert-file">{t('hybrid.certificate')}</label><input id="hybrid-cert-file" required type="file" accept=".pem,.crt,.cer" disabled={busy} onChange={event => setCertificate(event.target.files?.[0] || null)} /><p className="hybrid-field-hint">{t('hybrid.certificateFileHelp')}</p></div>
                <div className="field hybrid-file-field"><label htmlFor="hybrid-key-file">{t('hybrid.key')}</label><input id="hybrid-key-file" required type="file" accept=".pem,.key" disabled={busy} onChange={event => setPrivateKey(event.target.files?.[0] || null)} /><p className="hybrid-field-hint">{t('hybrid.keyFileHelp')}</p></div>
                {formError && <p className="hybrid-form-error" role="alert">{formError}</p>}
                <div className="btn-row flex-end hybrid-form-actions"><button className="btn btn-ghost" type="button" disabled={busy} onClick={() => setDialog(null)}>{t('common.cancel')}</button><button className="btn btn-primary" disabled={busy || !certificate || !privateKey} type="submit">{t(busy ? 'hybrid.importing' : 'hybrid.upload')}</button></div>
            </form>}
        </HybridDialog>}
    </section>;
}
