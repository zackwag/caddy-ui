import { UtilityIcon } from './Icons.jsx';

// A native select with the app's styling and arrow.
export default function Select({ wrapClassName = '', children, ...props }) {
    return <div className={`select-wrap ${wrapClassName}`.trim()}>
        <select className="config-select" {...props}>{children}</select>
        <span className="select-arrow"><UtilityIcon name="caretDown" size={10} /></span>
    </div>;
}
