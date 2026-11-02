import { useTranslation } from 'react-i18next';

export default function AuthenticatorCode({ id, value, onChange, autoFocus = false }) {
    const { t } = useTranslation();
    return <div className="field"><label htmlFor={id}>{t('totp.code')}</label>
        <input id={id} type="text" inputMode="numeric" autoComplete="one-time-code" required pattern="[0-9]{6}"
            maxLength={6} value={value} onChange={event => onChange(event.target.value)} autoFocus={autoFocus} />
    </div>;
}
