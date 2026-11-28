import { useTranslation } from 'react-i18next';
import ErrorNote from './ErrorNote.jsx';
import { useFetch } from '../hooks/useFetch.js';
import { historyActor } from '../utils/caddyfileHistory.js';
import { formatTs } from '../utils/format.js';

function describe(event, t) {
    const { action, resource, details = {} } = event;
    switch (action) {
        case 'instance.add': return t('activity.instanceAdd');
        case 'instance.edit': return t('activity.instanceEdit', { fields: (details.fields || []).join(', ') });
        case 'instance.remove': return t('activity.instanceRemove');
        case 'serverName.set': return t('activity.serverNameSet', { server: resource, name: details.name });
        case 'serverName.remove': return t('activity.serverNameRemove', { server: resource });
        case 'routeTitle.set': return details.title ? t('activity.routeTitleSet', { route: resource, title: details.title }) : t('activity.routeTitleClear', { route: resource });
        case 'notifications.configure': return details.enabled ? t('activity.notificationsEnabled', { provider: details.provider }) : t('activity.notificationsDisabled');
        case 'history.delete': return t('activity.historyDelete', { entry: resource });
        default: return action;
    }
}

export default function ActivityLog() {
    const { t } = useTranslation();
    const { data, error } = useFetch('/audit');
    const events = data?.events;

    return <div className="security-fields">
        <p className="modal-hint">{t('activity.hint')}</p>
        <ErrorNote error={error} />
        {events && !events.length && <p className="modal-hint">{t('activity.empty')}</p>}
        {events?.length > 0 && <ul className="api-token-list">{events.map(event => <li key={event.id}>
            <strong>{describe(event, t)}</strong>
            {event.outcome !== 'success' && <span className="login-error"> {t('activity.failed')}</span>}
            <p className="modal-hint">{event.instance ? (event.instance.name ?? event.instance.id) : t('activity.application')} · {historyActor(event, t)} · {formatTs(event.timestamp)}</p>
        </li>)}</ul>}
    </div>;
}
