// `online` is undefined until it's known.
export default function StatusDot({ online }) {
    return <div className={`status-dot ${online === undefined ? "" : online ? "online" : "offline"}`} />;
}
