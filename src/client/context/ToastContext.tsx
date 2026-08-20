import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  ReactNode,
} from 'react';
import { CheckCircle, AlertCircle, Info, AlertTriangle } from 'lucide-react';
import CloseButton from '../components/ui/CloseButton';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface Toast {
  id: string;
  message: string;
  type: ToastType;
  duration?: number;
}

interface ToastContextType {
  toasts: Toast[];
  addToast: (message: string, type?: ToastType, duration?: number) => void;
  removeToast: (id: string) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
  warning: (message: string) => void;
}

const ToastContext = createContext<ToastContextType | null>(null);

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback(
    (message: string, type: ToastType = 'info', duration: number = 5000) => {
      const id = Math.random().toString(36).substring(2, 9);
      const toast: Toast = { id, message, type, duration };
      setToasts((prev) => [...prev, toast]);
    },
    []
  );

  const success = useCallback(
    (message: string) => addToast(message, 'success', 5000),
    [addToast]
  );

  const error = useCallback(
    (message: string) => addToast(message, 'error', 8000),
    [addToast]
  );

  const info = useCallback(
    (message: string) => addToast(message, 'info', 5000),
    [addToast]
  );

  const warning = useCallback(
    (message: string) => addToast(message, 'warning', 6000),
    [addToast]
  );

  // Listen for session-expired events dispatched by AuthContext
  useEffect(() => {
    const handleSessionExpired = () => {
      addToast('Your session has expired. Please log in again.', 'warning', 8000);
    };
    window.addEventListener('session-expired', handleSessionExpired);
    return () => window.removeEventListener('session-expired', handleSessionExpired);
  }, [addToast]);

  return (
    <ToastContext.Provider
      value={{ toasts, addToast, removeToast, success, error, info, warning }}
    >
      {children}
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </ToastContext.Provider>
  );
}

export function ToastContainer({
  toasts,
  onRemove,
}: {
  toasts: Toast[];
  onRemove: (id: string) => void;
}) {
  if (toasts.length === 0) return null;

  return (
    <div
      aria-label="Notifications"
      className="fixed bottom-4 right-4 left-4 sm:left-auto z-50 flex flex-col items-end gap-2 pointer-events-none"
    >
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onRemove={onRemove} />
      ))}
    </div>
  );
}

export function ToastItem({
  toast,
  onRemove,
}: {
  toast: Toast;
  onRemove: (id: string) => void;
}) {
  const isAlert = toast.type === 'error' || toast.type === 'warning';
  const duration = toast.duration ?? (isAlert ? 8000 : 5000);

  const remainingRef = useRef<number>(duration);
  const startRef = useRef<number>(Date.now());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isPausedRef = useRef<boolean>(false);

  const startTimer = useCallback(() => {
    if (duration <= 0) return; // persistent
    isPausedRef.current = false;
    startRef.current = Date.now();
    timerRef.current = setTimeout(() => {
      onRemove(toast.id);
    }, remainingRef.current);
  }, [duration, onRemove, toast.id]);

  const pauseTimer = useCallback(() => {
    if (duration <= 0 || isPausedRef.current) return;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const elapsed = Date.now() - startRef.current;
    remainingRef.current = Math.max(0, remainingRef.current - elapsed);
    isPausedRef.current = true;
  }, [duration]);

  const resumeTimer = useCallback(() => {
    if (duration <= 0 || !isPausedRef.current) return;
    if (remainingRef.current <= 0) {
      onRemove(toast.id);
      return;
    }
    startTimer();
  }, [duration, onRemove, startTimer, toast.id]);

  useEffect(() => {
    startTimer();
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [startTimer]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        pauseTimer();
      } else {
        resumeTimer();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [pauseTimer, resumeTimer]);

  const icons = {
    success: <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400 flex-shrink-0" aria-hidden="true" />,
    error: <AlertCircle className="h-5 w-5 text-red-600 dark:text-red-400 flex-shrink-0" aria-hidden="true" />,
    info: <Info className="h-5 w-5 text-blue-600 dark:text-blue-400 flex-shrink-0" aria-hidden="true" />,
    warning: <AlertTriangle className="h-5 w-5 text-yellow-600 dark:text-yellow-400 flex-shrink-0" aria-hidden="true" />,
  };

  const backgrounds = {
    success: 'bg-green-50 border-green-200 dark:bg-green-950/80 dark:border-green-800',
    error: 'bg-red-50 border-red-200 dark:bg-red-950/80 dark:border-red-800',
    info: 'bg-blue-50 border-blue-200 dark:bg-blue-950/80 dark:border-blue-800',
    warning: 'bg-yellow-50 border-yellow-200 dark:bg-yellow-950/80 dark:border-yellow-800',
  };

  const textColors = {
    success: 'text-green-900 dark:text-green-100',
    error: 'text-red-900 dark:text-red-100',
    info: 'text-blue-900 dark:text-blue-100',
    warning: 'text-yellow-900 dark:text-yellow-100',
  };

  const truncatedMessage = toast.message.length > 40 ? `${toast.message.slice(0, 37)}...` : toast.message;
  const dismissLabel = `Dismiss notification: ${truncatedMessage}`;

  return (
    <div
      role={isAlert ? 'alert' : 'status'}
      aria-live={isAlert ? 'assertive' : 'polite'}
      aria-atomic="true"
      onPointerEnter={pauseTimer}
      onPointerLeave={resumeTimer}
      onMouseEnter={pauseTimer}
      onMouseLeave={resumeTimer}
      onFocusCapture={pauseTimer}
      onBlurCapture={resumeTimer}
      className={`pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-lg border shadow-lg w-full max-w-[calc(100vw-2rem)] sm:max-w-md min-w-0 motion-safe:animate-slide-in motion-reduce:animate-none ${backgrounds[toast.type]}`}
    >
      {icons[toast.type]}
      <p className={`flex-1 text-sm font-medium break-words ${textColors[toast.type]}`}>
        {toast.message}
      </p>
      <CloseButton
        onClose={() => onRemove(toast.id)}
        size="sm"
        label={dismissLabel}
        className={`${textColors[toast.type]} opacity-70 hover:opacity-100 flex-shrink-0`}
      />
    </div>
  );
}
