import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useFetch } from '../hooks/useFetch.js';
import { authRequest } from '../utils/api.js';
import { formatDate } from '../utils/format.js';
import ErrorNote from './ErrorNote.jsx';
import CredentialVerification from './CredentialVerification.jsx';
import { credentialProof, verificationReady } from '../utils/credentialVerification.js';
import { passkeyProblem, registerPasskey } from '../utils/passkeys.js';

export default function Passkeys({ busy, setBusy, disabled, onOpenTls, authState, onChange }) {
    const { t } = useTranslation();
    const { data, error: loadError, loading, reload, setData } = useFetch('/auth/passkeys');
    const [name, setName] = useState('');
    const [verification, setVerification] = useState({});
    const [removing, setRemoving] = useState(null);
    const [error, setError] = useState(null);
    const [saved, setSaved] = useState(false);

    async function add(event) {
        event.preventDefault();
        setBusy(true);
        setError(null);
        setSaved(false);
        try {
            // eslint-disable-next-line i18next/no-literal-string -- Backend credential-action identifier.
            const proof = await credentialProof(verification, authState, 'passkey.add');
            const key = await registerPasskey(name, proof);
            setData(previous => ({ ...previous, passkeys: [...previous.passkeys, key] }));
            setName('');
            setSaved(true);
            await onChange();
        } catch (error) { setError(error); }
        finally { setVerification({}); setBusy(false); }
    }

    async function remove(event) {
        event.preventDefault();
        setBusy(true);
        setError(null);
        setSaved(false);
        try {
            const proof = await credentialProof(verification, authState, `passkey.remove:${removing.id}`);
            await authRequest(`/passkeys/${encodeURIComponent(removing.id)}`, { method: 'DELETE', json: proof });
            setData(previous => ({ ...previous, passkeys: previous.passkeys.filter(key => key.id !== removing.id) }));
            setRemoving(null);
            await onChange();
        } catch (error) { setError(error); }
        finally { setVerification({}); setBusy(false); }
    }

    // Before the server answers (or when it can't), only the browser's own
    // checks apply, such as HTTPS, which is often why the load failed
    const problem = passkeyProblem(data ? { origin: data.origin, reason: data.unavailableReason, enabled: data.enabled } : { origin: window.location.origin });

    return <fieldset className="security-fields" disabled={disabled || busy || !authState}>
        <p className="modal-hint">{t('passkeys.hint')}</p>
        <ErrorNote error={error || loadError} />
        {saved && <p className="security-saved" role="status">{t('passkeys.saved')}</p>}
        {problem && <div className="auth-help"><p>{t(problem.key, problem.values)}</p>
            {problem.key === 'passkeys.httpsRequired' && <button type="button" className="btn btn-primary" disabled={disabled || busy} onClick={onOpenTls}>{t('passkeys.openTls')}</button>}
        </div>}
        {loading ? <p>{t('common.loading')}</p> : !data ?
            <button type="button" className="btn" onClick={reload}>{t('login.retry')}</button> : <>
            <p className="modal-hint">{t('passkeys.count', { count: data.passkeys.length, limit: data.limit })}</p>
            {!data.passkeys.length && <p className="modal-hint">{t('passkeys.empty')}</p>}
            <ul className="api-token-list">{data.passkeys.map(key => <li key={key.id}>
                <strong>{key.name}</strong>
                <div className="cell-muted">{t('passkeys.created', { date: formatDate(key.createdAt) })}</div>
                <button type="button" className="btn btn-danger" disabled={!!removing} aria-label={t('passkeys.removeNamed', { name: key.name })}
                    onClick={() => { setRemoving(key); setVerification({}); setError(null); }}>{t('common.delete')}</button>
            </li>)}</ul>
            {removing ? <form onSubmit={remove} className="passkey-remove-form">
                <p>{t('passkeys.removeConfirm', { name: removing.name })}</p>
                <p className="modal-hint">{t('passkeys.removeSessions')}</p>
                <CredentialVerification value={verification} setValue={setVerification} authState={authState}
                    passwordId="passkey-remove-password" passwordLabel="passkeys.removePassword" />
                <div className="btn-row"><button className="btn btn-danger" disabled={!verificationReady(verification, authState)}>{t('passkeys.confirmRemove')}</button>
                    <button type="button" className="btn" onClick={() => { setRemoving(null); setVerification({}); }}>{t('common.cancel')}</button></div>
            </form> : data.passkeys.length >= data.limit ? <p className="modal-hint">{t('errors.passkeyLimit')}</p> :
                <form onSubmit={add}>
                    <fieldset className="security-fields" disabled={!!problem}>
                        <div className="field"><label htmlFor="passkey-name">{t('passkeys.name')}</label>
                            <input id="passkey-name" required maxLength={80} value={name} onChange={event => setName(event.target.value)} /></div>
                        <CredentialVerification value={verification} setValue={setVerification} authState={authState}
                            passwordId="passkey-password" passwordLabel="passkeys.password" />
                        <button className="btn btn-primary" disabled={!name.trim() || !verificationReady(verification, authState)}>{t(busy ? 'passkeys.waiting' : 'passkeys.add')}</button>
                    </fieldset>
                </form>}
        </>}
    </fieldset>;
}
