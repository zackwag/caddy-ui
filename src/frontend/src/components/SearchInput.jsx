import { UtilityIcon } from "./Icons.jsx";

export default function SearchInput({ value, onChange, placeholder, clearLabel }) {
    return (
        <div className="search-wrap">
            <input className="search-input search-input--clearable" placeholder={placeholder} value={value} onChange={e => onChange(e.target.value)} />
            {value && <button className="search-clear" onClick={() => onChange("")} title={clearLabel}><UtilityIcon name="close" /></button>}
        </div>
    );
}
