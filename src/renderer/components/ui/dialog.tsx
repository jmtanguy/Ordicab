import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@renderer/lib/utils'

const dialogOverlayVariants = cva('fixed z-40 bg-slate-950/78 backdrop-blur-sm', {
  variants: {
    layout: {
      centered: 'inset-0 flex items-center justify-center p-4',
      stretched:
        'inset-x-3 bottom-3 top-17 flex items-stretch justify-stretch overflow-hidden rounded-[28px]'
    }
  },
  defaultVariants: {
    layout: 'centered'
  }
})

const dialogPanelVariants = cva(
  'flex flex-col border border-sky-200/18 bg-[rgba(16,26,44,0.985)] shadow-[0_32px_100px_rgba(2,6,23,0.62)]',
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
