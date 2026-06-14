import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AlertBanner } from '@renderer/components/ui'

interface ToastOptions {
  actionLabel?: string
  onAction?: () => void
  durationMs?: number
}

interface Toast {
  id: string
  message: string
  tone: 'success' | 'error' | 'warning'
  actionLabel?: string
  onAction?: () => void
}

interface ToastContextValue {
  showToast: (message: string, tone?: Toast['tone'], options?: ToastOptions) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

const TOAST_DURATION_MS = 4000

export function ToastProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const { t } = useTranslation()
  const [toasts, setToasts] = useState<Toast[]>([])
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
    timers.current.delete(id)
  }, [])

  const showToast = useCallback(
    (message: string, tone: Toast['tone'] = 'success', options?: ToastOptions) => {
      const id = `${Date.now()}-${Math.random()}`
      setToasts((prev) => [
        ...prev,
        { id, message, tone, actionLabel: options?.actionLabel, onAction: options?.onAction }
      ])

      const timer = setTimeout(() => dismiss(id), options?.durationMs ?? TOAST_DURATION_MS)
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
                <span className="flex items-center gap-3">
                  <span className="flex-1">{toast.message}</span>
                  {toast.actionLabel && toast.onAction ? (
                    <button
                      type="button"
                      onClick={() => {
                        toast.onAction?.()
                        dismiss(toast.id)
                      }}
                      className="shrink-0 rounded-full border border-current px-2.5 py-0.5 text-xs font-semibold underline-offset-2 transition hover:underline"
                    >
                      {toast.actionLabel}
                    </button>
                  ) : null}
                </span>
              </AlertBanner>
              <button
                type="button"
                onClick={() => dismiss(toast.id)}
                className="shrink-0 rounded-lg p-1 text-ink-muted transition hover:bg-parchment-dim hover:text-ink"
                aria-label={t('common.close', { defaultValue: 'Fermer' })}
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
