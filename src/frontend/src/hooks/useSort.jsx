import { useState } from "react";
import { UtilityIcon } from "../components/Icons.jsx";

// Column sorting: selecting the sorted column again reverses it.
export function useSort(initial) {
    const [{ column, ascending }, setSort] = useState({ column: initial, ascending: true });
    return {
        column,
        ascending,
        // Props for a column's header cell
        header: name => ({ onClick: () => setSort(sort => ({ column: name, ascending: sort.column === name ? !sort.ascending : true })) }),
        icon: name => column !== name
            ? <span className="sort-icon"><UtilityIcon name="sort" /></span>
            : <span className="sort-icon--active"><UtilityIcon name={ascending ? "arrowUp" : "arrowDown"} /></span>,
    };
}
