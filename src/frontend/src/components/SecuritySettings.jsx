import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ApiTokens from './ApiTokens.jsx';
import UserSettings from './UserSettings.jsx';
import { UtilityIcon } from './Icons.jsx';

export default function SecuritySettings({ onClose, onUnauth }) {
    const { t } = useTranslation();
    const dialog = useRef(null);
    const [userOpen, setUserOpen] = useState(true);
    const [tokensOpen, setTokensOpen] = useState(false);
    const [userBusy, setUserBusy] = useState(false);
    const [tokenBusy, setTokenBusy] = useState(false);
    const [issued, setIssued] = useState(null);
    const locked = userBusy || tokenBusy || !!issued;

    useEffect(() => {
        const element = dialog.current;
        element.showModal();
        return () => element.close();
    }, []);

    return <dialog ref={dialog} className="modal security-dialog" aria-labelledby="security-title"
        onCancel={event => { event.preventDefault(); if (!locked) onClose(); }}>
        <h2 className="modal-title" id="security-title">{t('security.title')}</h2>
        <section className="security-section">
            <h3><button type="button" className="security-toggle" aria-expanded={userOpen} aria-controls="security-user"
                disabled={locked} onClick={() => setUserOpen(value => !value)}>
                <span>{t('security.user')}</span><UtilityIcon name="chevronDown" />
            </button></h3>
            <div id="security-user" className="security-section-body" hidden={!userOpen}>
                <UserSettings onUnauth={onUnauth} busy={userBusy} setBusy={setUserBusy} disabled={tokenBusy || !!issued} />
            </div>
        </section>
        <section className="security-section">
            <h3><button type="button" className="security-toggle" disabled aria-expanded={false}>
                <span>{t('security.auth')}</span><span className="badge">{t('security.comingLater')}</span>
            </button></h3>
            <p className="modal-hint security-planned">{t('security.authHint')}</p>
        </section>
        <section className="security-section">
            <h3><button type="button" className="security-toggle" aria-expanded={tokensOpen} aria-controls="security-tokens"
                disabled={locked} onClick={() => setTokensOpen(value => !value)}>
                <span>{t('apiTokens.title')}</span><UtilityIcon name="chevronDown" />
            </button></h3>
            <div id="security-tokens" className="security-section-body" hidden={!tokensOpen}>
                <ApiTokens onUnauth={onUnauth} busy={tokenBusy} setBusy={setTokenBusy} issued={issued} setIssued={setIssued} disabled={userBusy} />
            </div>
        </section>
        <div className="btn-row flex-end"><button type="button" className="btn btn-ghost" disabled={locked} onClick={onClose}>{t('common.close')}</button></div>
    </dialog>;
}
