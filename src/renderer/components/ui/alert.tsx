import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@renderer/lib/utils'

const alertBannerVariants = cva('rounded-xl border px-4 py-3 text-sm', {
  variants: {
    tone: {
      neutral: 'border-[#e5e3da] bg-[#f4f3ee] text-[#1a1a1a]',
      success: 'border-[#cfe0c5] bg-[#f1f7ec] text-[#3c6132]',
      error: 'border-[#e8c7c7] bg-[#fbf0f0] text-[#9c2f2f]',
      warning: 'border-[#e8d5a3] bg-[#fbf5e3] text-[#7a5a00]'
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
