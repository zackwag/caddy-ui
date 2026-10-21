import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiFetch, authRequest } from '../utils/api.js';
import CredentialVerification from './CredentialVerification.jsx';
import { credentialProof, verificationReady } from '../utils/credentialVerification.js';
import { localizeError } from '../utils/errorMessages.js';

export default function UserSettings({ onUnauth, busy, setBusy, disabled, authState }) {
    const { t } = useTranslation();
    const [username, setUsername] = useState('');
    const [savedUsername, setSavedUsername] = useState(null);
    const [verification, setVerification] = useState({});
    const [password, setPassword] = useState('');
    const [confirmation, setConfirmation] = useState('');
    const [error, setError] = useState(null);
    const [saved, setSaved] = useState(false);
    const [loading, setLoading] = useState(true);
    const [attempt, setAttempt] = useState(0);

    useEffect(() => {
        let active = true;
        apiFetch('/auth/credentials', {}, onUnauth).then(data => {
            if (!active) return;
            setUsername(data.username);
            setSavedUsername(data.username);
        }).catch(error => { if (active) setError(error); })
            .finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, [onUnauth, attempt]);

    async function save(event) {
        event.preventDefault();
        setSaved(false);
        setError(null);
        if (password !== confirmation) { setError({ errorKey: 'login.passwordMismatch' }); return; }
        setBusy(true);
        try {
            // eslint-disable-next-line i18next/no-literal-string -- Backend credential-action identifier.
            const proof = password ? await credentialProof(verification, authState, 'password.change', onUnauth) : { currentPassword: verification.currentPassword };
            const result = await authRequest('/credentials', { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...proof, username, ...(password ? { password } : {}) }) }, onUnauth);
            setUsername(result.username);
            setSavedUsername(result.username);
            setPassword('');
            setConfirmation('');
            setSaved(true);
        } catch (error) { setError(error); }
        finally { setVerification({}); setBusy(false); }
    }

    return <>
        <p className="modal-hint">{t('security.userHint')}</p>
        {error && <p className="login-error" role="alert">{error.errorKey ? t(error.errorKey) : localizeError(error, t)}</p>}
        {saved && <p className="security-saved" role="status">{t('security.saved')}</p>}
        {loading ? <p>{t('common.loading')}</p> : savedUsername === null ?
            <button type="button" className="btn" onClick={() => { setError(null); setLoading(true); setAttempt(value => value + 1); }}>{t('login.retry')}</button> :
            <form onSubmit={save}>
                <fieldset className="security-fields" disabled={disabled || busy || !authState}>
                    <div className="field"><label htmlFor="security-username">{t('login.username')}</label>
                        <input id="security-username" autoComplete="username" required maxLength={128} value={username}
                            onChange={event => { setUsername(event.target.value); setSaved(false); }} /></div>
                    <CredentialVerification value={verification} setValue={setVerification}
                        authState={password ? authState : { ...authState, passkeyLoginAvailable: false, totpEnabled: false }} passwordId="security-current-password" />
                    <div className="field"><label htmlFor="security-new-password">{t('security.newPassword')}</label>
                        <input id="security-new-password" type="password" autoComplete="new-password" minLength={12} maxLength={1024}
                            aria-describedby="security-password-hint" value={password}
                            onChange={event => { setPassword(event.target.value); setSaved(false); }} /></div>
                    <p className="modal-hint" id="security-password-hint">{t('security.passwordHint')} {t('login.passwordHint')}</p>
                    <div className="field"><label htmlFor="security-confirm-password">{t('login.confirmPassword')}</label>
                        <input id="security-confirm-password" type="password" autoComplete="new-password" required={!!password}
                            value={confirmation} onChange={event => setConfirmation(event.target.value)} /></div>
                    <button className="btn btn-primary" disabled={(password ? !verificationReady(verification, authState) : !verification.currentPassword) || !username.trim() || (username === savedUsername && !password)}>
                        {t(busy ? 'login.saving' : 'common.save')}
                    </button>
                </fieldset>
            </form>}
    </>;
}
