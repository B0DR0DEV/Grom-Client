import { useEffect, useState } from 'react';

let toastFn: ((msg: string) => void) | null = null;

export function toast(msg: string) {
  if (toastFn) toastFn(msg);
}

export default function ToastContainer() {
  const [toasts, setToasts] = useState<{ id: number; msg: string }[]>([]);

  useEffect(() => {
    toastFn = (msg: string) => {
      const id = Date.now();
      setToasts((prev) => [...prev, { id, msg }]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 3000);
    };
    return () => { toastFn = null; };
  }, []);

  return (
    <div className="toast-container">
      {toasts.map((t) => (
        <div key={t.id} className="toast">{t.msg}</div>
      ))}
    </div>
  );
}