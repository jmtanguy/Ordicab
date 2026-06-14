import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@renderer/lib/utils'

const dialogOverlayVariants = cva(
  'fixed inset-0 z-40 bg-[rgba(15,122,138,0.18)] backdrop-blur-sm',
  {
    variants: {
      layout: {
        centered: 'flex items-center justify-center p-4',
        stretched: 'flex items-stretch justify-stretch p-3'
      }
    },
    defaultVariants: {
      layout: 'centered'
    }
  }
)

const dialogPanelVariants = cva(
  'flex flex-col border border-hairline-strong bg-parchment shadow-[0_30px_80px_rgba(10,92,104,0.28)] ring-1 ring-aurora/15',
  {
    variants: {
      layout: {
        centered: 'w-full max-h-[calc(100vh-3rem)] overflow-y-auto rounded-[28px] p-5',
        stretched: 'min-h-0 w-full overflow-hidden rounded-[28px] p-5'
      },
      size: {
        md: 'max-w-lg',
        lg: 'max-w-2xl',
        xl: 'max-w-[76rem]',
        full: ''
      }
    },
    defaultVariants: {
      layout: 'centered',
      size: 'md'
    }
  }
)

export interface DialogShellProps
  extends
    React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof dialogOverlayVariants>,
    VariantProps<typeof dialogPanelVariants> {
  panelClassName?: string
  /** Optional Escape-to-dismiss handler. Wired at the document level. */
  onDismiss?: () => void
}

export function DialogShell({
  children,
  className,
  layout,
  panelClassName,
  size,
  onDismiss,
  ...props
}: DialogShellProps): React.JSX.Element {
  React.useEffect(() => {
    if (!onDismiss) return undefined
    function handleKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onDismiss?.()
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('keydown', handleKey)
    }
  }, [onDismiss])

  return (
    <div className={cn(dialogOverlayVariants({ layout }), className)}>
      <div
        role="dialog"
        aria-modal="true"
        className={cn(dialogPanelVariants({ layout, size }), panelClassName)}
        {...props}
      >
        {children}
      </div>
    </div>
  )
}
