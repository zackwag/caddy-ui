import { useTranslation } from 'react-i18next';
import { canVerifyWithPasskey, verificationMethod } from '../utils/credentialVerification.js';
import AuthenticatorCode from './AuthenticatorCode.jsx';

export default function CredentialVerification({ value, setValue, authState, passwordId, passwordLabel = 'security.currentPassword' }) {
    const { t } = useTranslation();
    const method = verificationMethod(value, authState);
    return <>
        {canVerifyWithPasskey(authState) && <div className="field credential-method">
            <label><input type="radio" name={passwordId} checked={method === 'passkey'} onChange={() => setValue({ method: 'passkey' })} />
                {t('reauth.passkey')}</label>
            <label><input type="radio" name={passwordId} checked={method === 'password'} onChange={() => setValue({ method: 'password' })} />
                {t(authState.totpEnabled ? 'reauth.passwordTotp' : 'reauth.password')}</label>
        </div>}
        {method === 'passkey' ? <p className="modal-hint">{t('reauth.passkeyHint')}</p> : <>
            <div className="field"><label htmlFor={passwordId}>{t(passwordLabel)}</label>
                <input id={passwordId} type="password" required autoComplete="current-password" maxLength={1024}
                    value={value.currentPassword || ''} onChange={event => setValue({ ...value, currentPassword: event.target.value })} /></div>
            {authState?.totpEnabled && <AuthenticatorCode id={`${passwordId}-totp`} value={value.totpCode || ''}
                onChange={totpCode => setValue({ ...value, totpCode })} />}
        </>}
    </>;
}
