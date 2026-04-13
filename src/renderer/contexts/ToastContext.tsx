import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'

import { AlertBanner } from '@renderer/components/ui'

interface Toast {
  id: string
  message: string
  tone: 'success' | 'error' | 'warning'
}

interface ToastContextValue {
  showToast: (message: string, tone?: Toast['tone']) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

const TOAST_DURATION_MS = 4000

export function ToastProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [toasts, setToasts] = useState<Toast[]>([])
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
    timers.current.delete(id)
  }, [])

  const showToast = useCallback(
    (message: string, tone: Toast['tone'] = 'success') => {
      const id = `${Date.now()}-${Math.random()}`
      setToasts((prev) => [...prev, { id, message, tone }])

      const timer = setTimeout(() => dismiss(id), TOAST_DURATION_MS)
      timers.current.set(id, timer)
    },
    [dismiss]
  )

  useEffect(() => {
    const current = timers.current
    return () => {
      current.forEach((timer) => clearTimeout(timer))
    }
  }, [])

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {toasts.length > 0 && (
        <div
          className="fixed right-4 top-4 z-50 flex flex-col gap-2"
          role="region"
          aria-live="polite"
        >
          {toasts.map((toast) => (
            <div key={toast.id} className="flex items-center gap-3 min-w-64 max-w-sm">
              <AlertBanner tone={toast.tone} className="flex-1 shadow-lg">
                {toast.message}
              </AlertBanner>
              <button
                type="button"
                onClick={() => dismiss(toast.id)}
                className="shrink-0 rounded-lg p-1 text-slate-400 transition hover:bg-white/10 hover:text-slate-100"
                aria-label="Fermer"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </ToastContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within a ToastProvider')
  return ctx
}
