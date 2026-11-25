import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { authRequest } from '../utils/api.js';
import { useFetch } from '../hooks/useFetch.js';
import CredentialVerification from './CredentialVerification.jsx';
import { credentialProof, requireMatchingPasswords, verificationReady } from '../utils/credentialVerification.js';
import ErrorNote from './ErrorNote.jsx';
import NewPassword from './NewPassword.jsx';

export default function UserSettings({ busy, setBusy, disabled, authState }) {
    const { t } = useTranslation();
    const { data, error: loadError, loading, reload, setData } = useFetch('/auth/credentials');
    const [draft, setDraft] = useState(null);
    const [verification, setVerification] = useState({});
    const [newPassword, setNewPassword] = useState({});
    const [error, setError] = useState(null);
    const [saved, setSaved] = useState(false);
    const username = draft ?? data?.username ?? '';
    const { password } = newPassword;
    // Renaming the account takes only the password; replacing the password
    // takes whatever the account is protected with.
    const required = password || !authState ? authState : { ...authState, passkeyLoginAvailable: false, totpEnabled: false };

    async function save(event) {
        event.preventDefault();
        setSaved(false);
        setError(null);
        try { requireMatchingPasswords(newPassword); }
        catch (error) { setError(error); return; }
        setBusy(true);
        try {
            // eslint-disable-next-line i18next/no-literal-string -- Backend credential-action identifier.
            const proof = await credentialProof(verification, required, 'password.change');
            const result = await authRequest('/credentials', { method: 'PATCH', json: { ...proof, username, ...(password ? { password } : {}) } });
            setData(() => result);
            setDraft(null);
            setNewPassword({});
            setSaved(true);
        } catch (error) { setError(error); }
        finally { setVerification({}); setBusy(false); }
    }

    return <>
        <p className="modal-hint">{t('security.userHint')}</p>
        <ErrorNote error={error || loadError} />
        {saved && <p className="security-saved" role="status">{t('security.saved')}</p>}
        {loading ? <p>{t('common.loading')}</p> : !data ?
            <button type="button" className="btn" onClick={reload}>{t('login.retry')}</button> :
            <form onSubmit={save}>
                <fieldset className="security-fields" disabled={disabled || busy || !authState}>
                    <div className="field"><label htmlFor="security-username">{t('login.username')}</label>
                        <input id="security-username" autoComplete="username" required maxLength={128} value={username}
                            onChange={event => { setDraft(event.target.value); setSaved(false); }} /></div>
                    <CredentialVerification value={verification} setValue={setVerification}
                        authState={required} passwordId="security-current-password" />
                    <NewPassword id="security-new" label={t('security.newPassword')} hint={t('security.passwordHint')} required={false}
                        value={newPassword} onChange={value => { setNewPassword(value); setSaved(false); }} />
                    <button className="btn btn-primary" disabled={!verificationReady(verification, required) || !username.trim() || (username === data.username && !password)}>
                        {t(busy ? 'login.saving' : 'common.save')}
                    </button>
                </fieldset>
            </form>}
    </>;
}
