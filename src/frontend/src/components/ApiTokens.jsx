import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiFetch, getInstanceId } from '../utils/api.js';
import { formatTs } from '../utils/format.js';
import { useFetch } from '../hooks/useFetch.js';
import { API_TOKEN_SCOPE_KEYS as SCOPE_KEYS } from '../settings.js';
import ErrorNote from './ErrorNote.jsx';
import Select from './Select.jsx';

const STATUS_SCOPE = 'status:read';

export default function ApiTokens({ instances, instancesError, busy, setBusy, issued, setIssued, disabled }) {
    const { t } = useTranslation();
    const { data, error: loadError, loading: loadingTokens, setData } = useFetch('/auth/tokens');
    const [name, setName] = useState('');
    const [scopes, setScopes] = useState([STATUS_SCOPE]);
    const [selectedIds, setSelectedIds] = useState(null);
    const [days, setDays] = useState(90);
    const [error, setError] = useState(null);
    const tokens = data?.tokens || [];
    const loading = loadingTokens || (!instances && !instancesError);
    // After a failed load there is no list yet, but a token can still be issued
    const setTokens = change => setData(previous => ({ ...previous, tokens: change(previous?.tokens ?? []) }));
    // The instance being managed, until a selection is made
    const instanceIds = selectedIds ?? (instances || []).map(instance => instance.id).filter(id => id === getInstanceId());

    function toggle(value, selected, setSelected) {
        setSelected(selected.includes(value) ? selected.filter(item => item !== value) : [...selected, value]);
    }

    async function create(event) {
        event.preventDefault();
        setBusy(true);
        setError(null);
        try {
            const result = await apiFetch('/auth/tokens', { method: 'POST', json: { name, scopes, instanceIds, expiresInDays: days } });
            const { token, ...metadata } = result;
            setTokens(previous => [...previous, metadata]);
            setIssued({ token, id: metadata.id });
            setName('');
        } catch (error) { setError(error); }
        finally { setBusy(false); }
    }

    async function revoke(id) {
        setBusy(true);
        setError(null);
        try {
            await apiFetch(`/auth/tokens/${encodeURIComponent(id)}`, { method: 'DELETE' });
            setTokens(previous => previous.filter(token => token.id !== id));
            return true;
        } catch (error) { setError(error); return false; }
        finally { setBusy(false); }
    }

    return <fieldset className="security-fields" disabled={disabled || busy}>
        <p className="modal-hint">{t('apiTokens.hint')}</p>
        <ErrorNote error={error || loadError || instancesError} />
        {loading ? <p>{t('common.loading')}</p> : issued ? <section>
            <p className="modal-hint">{t('apiTokens.oneTime')}</p>
            <div className="field"><label htmlFor="issued-api-token">{t('apiTokens.secret')}</label>
                <textarea id="issued-api-token" className="auth-recovery-key" rows={3} readOnly value={issued.token} dir="ltr" spellCheck={false} /></div>
            <div className="btn-row">
                <button className="btn btn-primary" disabled={busy} onClick={() => setIssued(null)}>{t('apiTokens.saved')}</button>
                <button className="btn btn-danger" disabled={busy} onClick={async () => {
                    if (await revoke(issued.id)) {
                        setIssued(null);
                    }
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
                    {instances?.map(instance => <label className="auth-ack" key={instance.id}>
                        <input type="checkbox" checked={instanceIds.includes(instance.id)} disabled={busy} onChange={() => toggle(instance.id, instanceIds, setSelectedIds)} />
                        <span>{instance.name}<br /><code className="cell-muted">{instance.id}</code></span>
                    </label>)}
                    {!instances?.length && <p className="modal-hint">{t('apiTokens.noInstances')}</p>}
                </fieldset>
                <div className="field"><label htmlFor="api-token-expiry">{t('apiTokens.expiry')}</label>
                    <Select id="api-token-expiry" value={days} onChange={event => setDays(Number(event.target.value))}>
                        {[30, 90, 365].map(days => <option value={days} key={days}>{t('apiTokens.days', { days })}</option>)}
                    </Select></div>
                <button className="btn btn-primary" disabled={busy || !name.trim() || !scopes.length || !instanceIds.length}>{t('apiTokens.create')}</button>
            </form>
            <h3 className="modal-section-label">{t('apiTokens.existing')}</h3>
            {!tokens.length && !loadError && <p className="modal-hint">{t('apiTokens.empty')}</p>}
            <ul className="api-token-list">{tokens.map(token => <li key={token.id}>
                <strong>{token.name}</strong>
                <p className="modal-hint">{token.scopes.map(scope => t(SCOPE_KEYS[scope])).join(', ')}</p>
                <p className="modal-hint">{token.instanceIds.map(id => {
                    const instance = instances?.find(instance => instance.id === id);
                    return instance ? `${instance.name} (${id})` : id;
                }).join(', ')}</p>
                <p className="modal-hint">{t('apiTokens.expiresAt', { date: formatTs(token.expiresAt) })}</p>
                <button className="btn btn-danger" disabled={busy} aria-label={t('apiTokens.revokeNamed', { name: token.name })} onClick={() => revoke(token.id)}>{t('apiTokens.revoke')}</button>
            </li>)}</ul>
        </>}
    </fieldset>;
}
