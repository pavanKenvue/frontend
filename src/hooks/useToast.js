import { useEffect, useRef, useState } from 'react';

export function useToast() {
  const [toast, setToast] = useState(null);
  const [leaving, setLeaving] = useState(false);
  const timersRef = useRef([]);

  const showToast = (msg, type = 'success') => {
    timersRef.current.forEach(clearTimeout);
    setLeaving(false);
    setToast({ msg, type });
    timersRef.current = [
      setTimeout(() => setLeaving(true), 1800),
      setTimeout(() => setToast(null), 2020),
    ];
  };

  useEffect(() => () => timersRef.current.forEach(clearTimeout), []);

  return { toast, leaving, showToast };
}
