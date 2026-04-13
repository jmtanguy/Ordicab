import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@renderer/lib/utils'

const alertBannerVariants = cva('rounded-xl border px-4 py-3 text-sm', {
  variants: {
    tone: {
      neutral: 'border-white/10 bg-slate-950/45 text-slate-300',
      success: 'border-emerald-300/35 bg-emerald-300/10 text-emerald-100',
      error: 'border-rose-300/35 bg-rose-300/10 text-rose-100',
      warning: 'border-amber-300/40 bg-amber-300/10 text-amber-100'
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
