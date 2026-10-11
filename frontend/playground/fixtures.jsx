import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '../src/components/Confirm.jsx';
import { Toasts } from '../src/components/Toasts.jsx';

export function RouteConfirmation() {
    const { t } = useTranslation();
    return <ConfirmDialog dialog={{ message: t('routes.deleteConfirm'), danger: true,
        confirmLabel: t('common.delete'), cancelLabel: t('common.cancel') }} resolve={() => {}} />;
}

export function CertificateConfirmation() {
    const { t } = useTranslation();
    return <ConfirmDialog dialog={{ message: t('tls.deleteConfirm', { status: 'expired', domain: 'example.home.arpa' }), danger: true,
        confirmLabel: t('common.delete'), cancelLabel: t('common.cancel') }} resolve={() => {}} />;
}

export function NotificationToast() {
    const { t } = useTranslation();
    return <Toasts toasts={[{ id: 1, type: 'success', msg: t('notifications.saved') }]} />;
}

