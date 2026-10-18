import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiFetch, getInstanceId } from '../utils/api.js';
import { localizeError } from '../utils/errorMessages.js';

const STATUS_SCOPE = 'status:read';
const SCOPE_KEYS = { [STATUS_SCOPE]: 'apiTokens.status', 'metrics:read': 'apiTokens.metrics' };

export default function ApiTokens({ onClose, onUnauth }) {
    const { t, i18n } = useTranslation();
    const dialog = useRef(null);
    const [tokens, setTokens] = useState([]);
    const [instances, setInstances] = useState([]);
    const [name, setName] = useState('');
    const [scopes, setScopes] = useState([STATUS_SCOPE]);
    const [instanceIds, setInstanceIds] = useState([]);
    const [days, setDays] = useState(90);
    const [issued, setIssued] = useState(null);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        const element = dialog.current;
        element.showModal();
        return () => element.close();
    }, []);

    useEffect(() => {
        let active = true;
        Promise.all([apiFetch('/auth/tokens', {}, onUnauth), apiFetch('/instances', {}, onUnauth)])
            .then(([data, instances]) => {
                if (!active) return;
                setTokens(data.tokens);
                setInstances(instances);
                setInstanceIds(instances.some(instance => instance.id === getInstanceId()) ? [getInstanceId()] : []);
            })
            .catch(error => { if (active) setError(localizeError(error, t)); })
            .finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, [onUnauth, t]);

    function toggle(value, selected, setSelected) {
        setSelected(selected.includes(value) ? selected.filter(item => item !== value) : [...selected, value]);
    }

    async function create(event) {
        event.preventDefault();
        setBusy(true);
        setError('');
        try {
            const result = await apiFetch('/auth/tokens', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, scopes, instanceIds, expiresInDays: days }) }, onUnauth);
            const { token, ...metadata } = result;
            setTokens(previous => [...previous, metadata]);
            setIssued({ token, id: metadata.id });
            setName('');
        } catch (error) { setError(localizeError(error, t)); }
        finally { setBusy(false); }
    }

    async function revoke(id) {
        setBusy(true);
        setError('');
        try {
            await apiFetch(`/auth/tokens/${encodeURIComponent(id)}`, { method: 'DELETE' }, onUnauth);
            setTokens(previous => previous.filter(token => token.id !== id));
            return true;
        } catch (error) { setError(localizeError(error, t)); return false; }
        finally { setBusy(false); }
    }

    return <dialog ref={dialog} className="modal api-tokens-dialog" aria-labelledby="api-tokens-title"
        onCancel={event => { event.preventDefault(); if (!busy && !issued) onClose(); }}>
        <h2 className="modal-title" id="api-tokens-title">{t('apiTokens.title')}</h2>
        <p className="modal-hint">{t('apiTokens.hint')}</p>
        {error && <p className="login-error" role="alert">{error}</p>}
        {loading ? <p>{t('common.loading')}</p> : issued ? <section>
            <p className="modal-hint">{t('apiTokens.oneTime')}</p>
            <div className="field"><label htmlFor="issued-api-token">{t('apiTokens.secret')}</label>
                <textarea id="issued-api-token" className="auth-recovery-key" rows={3} readOnly value={issued.token} dir="ltr" spellCheck={false} /></div>
            <div className="btn-row">
                <button className="btn btn-primary" disabled={busy} onClick={() => setIssued(null)}>{t('apiTokens.saved')}</button>
                <button className="btn btn-danger" disabled={busy} onClick={async () => {
                    if (await revoke(issued.id)) setIssued(null);
                }}>{t('apiTokens.discard')}</button>
            </div>
        </section> : <>
            <form onSubmit={create}>
                <div className="field"><label htmlFor="api-token-name">{t('apiTokens.name')}</label>
                    <input id="api-token-name" value={name} onChange={event => setName(event.target.value)} required maxLength={80} /></div>
                <fieldset className="api-token-options"><legend>{t('apiTokens.scopes')}</legend>
                    {Object.entries(SCOPE_KEYS).map(([scope, key]) => <label className="auth-ack" key={scope}>
                        <input type="checkbox" checked={scopes.includes(scope)} disabled={busy} onChange={() => toggle(scope, scopes, setScopes)} />{t(key)}
                    </label>)}
                </fieldset>
                <fieldset className="api-token-options"><legend>{t('apiTokens.instances')}</legend>
                    {instances.map(instance => <label className="auth-ack" key={instance.id}>
                        <input type="checkbox" checked={instanceIds.includes(instance.id)} disabled={busy} onChange={() => toggle(instance.id, instanceIds, setInstanceIds)} />
                        <span>{instance.name}<br /><code className="cell-muted">{instance.id}</code></span>
                    </label>)}
                    {!instances.length && <p className="modal-hint">{t('apiTokens.noInstances')}</p>}
                </fieldset>
                <div className="field"><label htmlFor="api-token-expiry">{t('apiTokens.expiry')}</label>
                    <select id="api-token-expiry" className="config-select" value={days} onChange={event => setDays(Number(event.target.value))}>
                        {[30, 90, 365].map(days => <option value={days} key={days}>{t('apiTokens.days', { days })}</option>)}
                    </select></div>
                <button className="btn btn-primary" disabled={busy || !name.trim() || !scopes.length || !instanceIds.length}>{t('apiTokens.create')}</button>
            </form>
            <h3 className="modal-section-label">{t('apiTokens.existing')}</h3>
            {!tokens.length && <p className="modal-hint">{t('apiTokens.empty')}</p>}
            <ul className="api-token-list">{tokens.map(token => <li key={token.id}>
                <strong>{token.name}</strong>
                <p className="modal-hint">{token.scopes.map(scope => t(SCOPE_KEYS[scope])).join(', ')}</p>
                <p className="modal-hint">{token.instanceIds.map(id => {
                    const instance = instances.find(instance => instance.id === id);
                    return instance ? `${instance.name} (${id})` : id;
                }).join(', ')}</p>
                <p className="modal-hint">{t('apiTokens.expiresAt', { date: new Date(token.expiresAt).toLocaleString(i18n.language) })}</p>
                <button className="btn btn-danger" disabled={busy} aria-label={t('apiTokens.revokeNamed', { name: token.name })} onClick={() => revoke(token.id)}>{t('apiTokens.revoke')}</button>
            </li>)}</ul>
        </>}
        <div className="btn-row flex-end"><button className="btn btn-ghost" disabled={busy || !!issued} onClick={onClose}>{t('common.close')}</button></div>
    </dialog>;
}
