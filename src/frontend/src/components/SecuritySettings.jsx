import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import ApiTokens from './ApiTokens.jsx';
import UserSettings from './UserSettings.jsx';
import TotpSettings from './TotpSettings.jsx';
import { apiFetch } from '../utils/api.js';
import { localizeError } from '../utils/errorMessages.js';
import Passkeys from './Passkeys.jsx';
import { UtilityIcon } from './Icons.jsx';

export default function SecuritySettings({ onClose, onUnauth }) {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const dialog = useRef(null);
    const [authState, setAuthState] = useState(null);
    const [error, setError] = useState(null);
    const [attempt, setAttempt] = useState(0);
    const [userOpen, setUserOpen] = useState(false);
    const [tokensOpen, setTokensOpen] = useState(false);
    const [authOpen, setAuthOpen] = useState(false);
    const [totpOpen, setTotpOpen] = useState(false);
    const [passkeysOpen, setPasskeysOpen] = useState(false);
    const [authBusy, setAuthBusy] = useState(false);
    const [userBusy, setUserBusy] = useState(false);
    const [tokenBusy, setTokenBusy] = useState(false);
    const [issued, setIssued] = useState(null);
    const locked = userBusy || tokenBusy || authBusy || !!issued;

    useEffect(() => {
        const element = dialog.current;
        element.showModal();
        return () => element.close();
    }, []);

    useEffect(() => {
        let active = true;
        apiFetch('/auth/status', {}, onUnauth).then(state => { if (active) setAuthState(state); })
            .catch(error => { if (active) setError(error); });
        return () => { active = false; };
    }, [onUnauth, attempt]);
    async function refreshAuth() {
        try { setAuthState(await apiFetch('/auth/status', {}, onUnauth)); }
        catch (error) { setAuthState(null); setError(error); }
    }

    return <dialog ref={dialog} className="modal security-dialog" aria-labelledby="security-title"
        onCancel={event => { event.preventDefault(); if (!locked) onClose(); }}>
        <h2 className="modal-title" id="security-title">{t('security.title')}</h2>
        {error && <div role="alert"><p>{localizeError(error, t)}</p>
            <button type="button" className="btn" disabled={locked} onClick={() => { setError(null); setAttempt(value => value + 1); }}>{t('login.retry')}</button></div>}
        <section className="security-section">
            <h3><button type="button" className="security-toggle" aria-expanded={userOpen} aria-controls="security-user"
                disabled={locked} onClick={() => setUserOpen(value => !value)}>
                <span>{t('security.user')}</span><UtilityIcon name="chevronDown" />
            </button></h3>
            <div id="security-user" className="security-section-body" hidden={!userOpen}>
                <UserSettings authState={authState} onUnauth={onUnauth} busy={userBusy} setBusy={setUserBusy} disabled={tokenBusy || authBusy || !!issued} />
            </div>
        </section>
        <section className="security-section">
            <h3><button type="button" className="security-toggle" disabled={locked} aria-expanded={authOpen} aria-controls="security-auth"
                onClick={() => { setAuthOpen(value => !value); setTotpOpen(false); setPasskeysOpen(false); }}>
                <span>{t('security.auth')}</span><UtilityIcon name="chevronDown" />
            </button></h3>
            <div id="security-auth" className="security-section-body security-auth-sections" hidden={!authOpen}>
                <section className="security-subsection">
                    <h4><button type="button" className="security-toggle" disabled={locked} aria-expanded={totpOpen} aria-controls="security-totp"
                        onClick={() => setTotpOpen(value => !value)}>
                        <span>{t('totp.title')}</span><UtilityIcon name="chevronDown" />
                    </button></h4>
                    <div id="security-totp" className="security-subsection-body" hidden={!totpOpen}>
                        {authOpen && totpOpen && <TotpSettings authState={authState} onChange={refreshAuth} onUnauth={onUnauth}
                            busy={authBusy} setBusy={setAuthBusy} disabled={userBusy || tokenBusy || !!issued} />}
                    </div>
                </section>
                <section className="security-subsection">
                    <h4><button type="button" className="security-toggle" disabled={locked} aria-expanded={passkeysOpen} aria-controls="security-passkeys"
                        onClick={() => setPasskeysOpen(value => !value)}>
                        <span>{t('passkeys.title')}</span><UtilityIcon name="chevronDown" />
                    </button></h4>
                    <div id="security-passkeys" className="security-subsection-body" hidden={!passkeysOpen}>
                        {authOpen && passkeysOpen && <Passkeys authState={authState} onChange={refreshAuth} onUnauth={onUnauth}
                            busy={authBusy} setBusy={setAuthBusy} disabled={userBusy || tokenBusy || !!issued}
                            onOpenTls={() => { onClose(); navigate('/tls'); }} />}
                    </div>
                </section>
            </div>
        </section>
        <section className="security-section">
            <h3><button type="button" className="security-toggle" aria-expanded={tokensOpen} aria-controls="security-tokens"
                disabled={locked} onClick={() => setTokensOpen(value => !value)}>
                <span>{t('apiTokens.title')}</span><UtilityIcon name="chevronDown" />
            </button></h3>
            <div id="security-tokens" className="security-section-body" hidden={!tokensOpen}>
                <ApiTokens onUnauth={onUnauth} busy={tokenBusy} setBusy={setTokenBusy} issued={issued} setIssued={setIssued} disabled={userBusy || authBusy} />
            </div>
        </section>
        <div className="btn-row flex-end"><button type="button" className="btn btn-ghost" disabled={locked} onClick={onClose}>{t('common.close')}</button></div>
    </dialog>;
}
