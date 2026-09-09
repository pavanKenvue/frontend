import { memo } from 'react';
import { sortValues, valuesMatch } from '../../utils/numericOps';

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
