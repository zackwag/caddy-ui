// The full-page card everything before sign-in is shown in; a form when it has
// something to submit.
export default function LoginCard({ onSubmit, children }) {
    return <div className="login-shell">
        {onSubmit ? <form className="login-card" onSubmit={onSubmit}>{children}</form> : <div className="login-card">{children}</div>}
    </div>;
}

export const LoginLogo = () => <div className="login-logo">caddy/ui</div>;
