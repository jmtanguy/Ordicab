import * as React from 'react'

import { cn } from '@renderer/lib/utils'

export function Card({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return <div className={cn('ord-glass-card rounded-2xl p-5', className)} {...props} />
}
