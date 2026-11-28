// A route or upstream status, a key of utils/routes.js STATUS_LABEL_KEYS, as a
// colored dot with `label` for screen readers.
export default function HealthDot({ status, label, className = "", ...props }) {
    return (
        <span className={`health-dot health-dot--${status} ${className}`.trim()} {...props}>
            {label && <span className="sr-only">{label}</span>}
        </span>
    );
}
