import { memo } from 'react';
import { sortValues, valuesMatch } from '../../utils/numericOps';

/**
 * Renders the checkbox list for the currently open column.
 *
 * Every value shown is selectable. The list arrives already cascaded from
 * /filter_multiple_values, so values that are invalid given the other applied
 * filters are simply not in it — there is nothing left to grey out.
 *
 * Wrapped in memo(): this list can run into hundreds of checkboxes, and
 * without it every keystroke in FilterBuilder's unrelated "type values"
 * textarea (a sibling, not a prop of this component) forced a full re-sort
 * and re-render of the whole list. onToggleValue is memoized by the caller
 * so this actually takes effect.
 */
function ValuesList({ values, checkedValues, onToggleValue, loading }) {
  if (loading) {
    return <div className="fb-val-loading">Loading...</div>;
  }
  if (!values.length) {
    return <div className="fb-val-empty">No values found</div>;
  }

  const sorted = sortValues(values);

  return (
    <div className="fb-val-list">
      {sorted.map((v) => {
        const vStr = String(v);
        const id = `cchk_${vStr}`;
        return (
          <div key={vStr} className="fb-val-item">
            <input
              type="checkbox"
              id={id}
              checked={checkedValues.some((cv) => valuesMatch(cv, vStr))}
              onChange={() => onToggleValue(vStr)}
            />
            <label htmlFor={id}>{vStr}</label>
          </div>
        );
      })}
    </div>
  );
}

export default memo(ValuesList);
