import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiFetch, authRequest } from '../utils/api.js';
import { localizeError } from '../utils/errorMessages.js';
import { passkeySupport, registerPasskey } from '../utils/passkeys.js';

export default function Passkeys({ onUnauth, busy, setBusy, disabled, onOpenTls }) {
    const { t } = useTranslation();
    const [data, setData] = useState(null);
    const [attempt, setAttempt] = useState(0);
    const [loading, setLoading] = useState(true);
    const [name, setName] = useState('');
    const [password, setPassword] = useState('');
    const [removing, setRemoving] = useState(null);
    const [removePassword, setRemovePassword] = useState('');
    const [error, setError] = useState(null);
    const [saved, setSaved] = useState(false);
    const support = passkeySupport();

    useEffect(() => {
        let active = true;
        apiFetch('/auth/passkeys', {}, onUnauth).then(value => { if (active) setData(value); })
            .catch(error => { if (active) setError(error); })
            .finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, [onUnauth, attempt]);

    async function add(event) {
        event.preventDefault();
        setBusy(true);
        setError(null);
        setSaved(false);
        try {
            const key = await registerPasskey(name, password, onUnauth);
            setData(previous => ({ ...previous, passkeys: [...previous.passkeys, key] }));
            setName('');
            setSaved(true);
        } catch (error) { setError(error); }
        finally { setPassword(''); setBusy(false); }
    }

    async function remove(event) {
        event.preventDefault();
        setBusy(true);
        setError(null);
        setSaved(false);
        try {
            await authRequest(`/passkeys/${encodeURIComponent(removing.id)}`, { method: 'DELETE',
                headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ currentPassword: removePassword }) }, onUnauth);
            setData(previous => ({ ...previous, passkeys: previous.passkeys.filter(key => key.id !== removing.id) }));
            setRemoving(null);
        } catch (error) { setError(error); }
        finally { setRemovePassword(''); setBusy(false); }
    }

    const unavailable = !support.secure ? t('passkeys.httpsRequired') : !support.supported ? t('passkeys.unsupported')
        : data?.unavailableReason === 'ip-address' ? t('errors.passkeyIpUnavailable')
            : data && !data.enabled ? t('errors.passkeyUnavailable')
                : data && data.origin !== window.location.origin ? t('passkeys.originMismatch', { origin: data.origin }) : null;

    return <fieldset className="security-fields" disabled={disabled || busy}>
        <h4 className="modal-section-label">{t('passkeys.title')}</h4>
        <p className="modal-hint">{t('passkeys.hint')}</p>
        {error && <p className="login-error" role="alert">{localizeError(error, t)}</p>}
        {saved && <p className="security-saved" role="status">{t('passkeys.saved')}</p>}
        {unavailable && <div className="auth-help"><p>{unavailable}</p>
            {!support.secure && <button type="button" className="btn" disabled={disabled || busy} onClick={onOpenTls}>{t('passkeys.openTls')}</button>}
        </div>}
        {loading ? <p>{t('common.loading')}</p> : !data ?
            <button type="button" className="btn" onClick={() => { setError(null); setLoading(true); setAttempt(value => value + 1); }}>{t('login.retry')}</button> : <>
            <p className="modal-hint">{t('passkeys.count', { count: data.passkeys.length, limit: data.limit })}</p>
            {!data.passkeys.length && <p className="modal-hint">{t('passkeys.empty')}</p>}
            <ul className="api-token-list">{data.passkeys.map(key => <li key={key.id}>
                <strong>{key.name}</strong>
                <div className="cell-muted">{t('passkeys.created', { date: new Date(key.createdAt).toLocaleDateString() })}</div>
                <button type="button" className="btn btn-danger" disabled={!!removing} aria-label={t('passkeys.removeNamed', { name: key.name })}
                    onClick={() => { setRemoving(key); setRemovePassword(''); setError(null); }}>{t('common.delete')}</button>
            </li>)}</ul>
            {removing ? <form onSubmit={remove} className="passkey-remove-form">
                <p>{t('passkeys.removeConfirm', { name: removing.name })}</p>
                <p className="modal-hint">{t('passkeys.removeSessions')}</p>
                <div className="field"><label htmlFor="passkey-remove-password">{t('passkeys.removePassword')}</label>
                    <input id="passkey-remove-password" type="password" required autoComplete="current-password" maxLength={1024}
                        value={removePassword} onChange={event => setRemovePassword(event.target.value)} /></div>
                <div className="btn-row"><button className="btn btn-danger" disabled={!removePassword}>{t('passkeys.confirmRemove')}</button>
                    <button type="button" className="btn" onClick={() => { setRemoving(null); setRemovePassword(''); }}>{t('common.cancel')}</button></div>
            </form> : data.passkeys.length >= data.limit ? <p className="modal-hint">{t('errors.passkeyLimit')}</p> :
                <form onSubmit={add}>
                    <fieldset className="security-fields" disabled={!!unavailable}>
                        <div className="field"><label htmlFor="passkey-name">{t('passkeys.name')}</label>
                            <input id="passkey-name" required maxLength={80} value={name} onChange={event => setName(event.target.value)} /></div>
                        <div className="field"><label htmlFor="passkey-password">{t('passkeys.password')}</label>
                            <input id="passkey-password" type="password" required autoComplete="current-password" maxLength={1024}
                                value={password} onChange={event => setPassword(event.target.value)} /></div>
                        <button className="btn btn-primary" disabled={!name.trim() || !password}>{t(busy ? 'passkeys.waiting' : 'passkeys.add')}</button>
                    </fieldset>
                </form>}
        </>}
        <p className="modal-hint security-planned passkey-planned">{t('passkeys.totpLater')}</p>
    </fieldset>;
}
