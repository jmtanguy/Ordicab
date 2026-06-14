import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@renderer/lib/utils'

const alertBannerVariants = cva('rounded-xl border px-4 py-3 text-sm', {
  variants: {
    tone: {
      neutral: 'border-hairline bg-parchment text-ink',
      success: 'border-success-border bg-success-tint text-success-deep',
      error: 'border-destructive-border bg-destructive-tint text-destructive',
      warning: 'border-warning-border bg-warning-tint text-warning-deep'
    }
  },
  defaultVariants: {
    tone: 'neutral'
  }
})

export interface AlertBannerProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof alertBannerVariants> {}

export function AlertBanner({ className, tone, ...props }: AlertBannerProps): React.JSX.Element {
  return <div className={cn(alertBannerVariants({ tone }), className)} {...props} />
}
