const ICON_PATHS = {
  success: 'M20 6 9 17l-5-5',
  error: 'M12 8v5m0 3.5h.01M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z',
};

export default function Toast({ toast, leaving }) {
  if (!toast) return null;
  return (
    <div className="bm-toast-row">
      <div className={`bm-toast bm-toast-${toast.type}${leaving ? ' bm-toast-leaving' : ''}`} role="status">
        <span className="bm-toast-icon">
          <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d={ICON_PATHS[toast.type === 'error' ? 'error' : 'success']} />
          </svg>
        </span>
        <span className="bm-toast-msg">{toast.msg}</span>
      </div>
    </div>
  );
}
