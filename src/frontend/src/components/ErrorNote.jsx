import { useTranslation } from 'react-i18next';
import { localizeError } from '../utils/errorMessages.js';

export default function ErrorNote({ error }) {
    const { t } = useTranslation();
    return error ? <p className="login-error" role="alert">{localizeError(error, t)}</p> : null;
}
