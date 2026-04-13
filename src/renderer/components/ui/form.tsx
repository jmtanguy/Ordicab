import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@renderer/lib/utils'

const fieldVariants = cva('flex flex-col text-sm', {
  variants: {
    density: {
      default: 'gap-2 text-slate-100',
      compact: 'gap-1.5 text-slate-200'
    }
  },
  defaultVariants: {
    density: 'default'
  }
})

const fieldLabelVariants = cva('', {
  variants: {
    tone: {
      default: '',
      eyebrow: 'text-xs uppercase tracking-[0.16em] text-slate-400'
    }
  },
  defaultVariants: {
    tone: 'default'
  }
})

const fieldMessageVariants = cva('text-xs', {
  variants: {
    tone: {
      subtle: 'text-slate-400',
      error: 'text-rose-300'
    }
  },
  defaultVariants: {
    tone: 'subtle'
  }
})

const controlVariants = cva(
  'w-full rounded-2xl border border-white/10 bg-slate-950/60 text-sm text-slate-100 outline-none transition focus:border-aurora focus:ring-2 focus:ring-aurora/35 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      density: {
        default: 'px-4 py-3',
        compact: 'px-4 py-2.5'
      }
    },
    defaultVariants: {
      density: 'default'
    }
  }
)

type FieldDensity = NonNullable<VariantProps<typeof fieldVariants>['density']>
type FieldLabelTone = NonNullable<VariantProps<typeof fieldLabelVariants>['tone']>
type ControlDensity = NonNullable<VariantProps<typeof controlVariants>['density']>

export interface FieldProps
  extends React.LabelHTMLAttributes<HTMLLabelElement>, VariantProps<typeof fieldVariants> {
  label: React.ReactNode
  error?: React.ReactNode
  labelTone?: FieldLabelTone
  labelClassName?: string
}

export function Field({
  children,
  className,
  density,
  error,
  label,
  labelClassName,
  labelTone = 'default',
  ...props
}: FieldProps): React.JSX.Element {
  return (
    <label className={cn(fieldVariants({ density }), className)} {...props}>
      <span className={cn(fieldLabelVariants({ tone: labelTone }), labelClassName)}>{label}</span>
      {children}
      {error ? <FieldMessage tone="error">{error}</FieldMessage> : null}
    </label>
  )
}

export interface FieldMessageProps
  extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof fieldMessageVariants> {}

export function FieldMessage({ className, tone, ...props }: FieldMessageProps): React.JSX.Element {
  return <span className={cn(fieldMessageVariants({ tone }), className)} {...props} />
}

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement>, VariantProps<typeof controlVariants> {}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, density, ...props }, ref) => {
    return <input ref={ref} className={cn(controlVariants({ density }), className)} {...props} />
  }
)
Input.displayName = 'Input'

export interface SelectProps
  extends React.SelectHTMLAttributes<HTMLSelectElement>, VariantProps<typeof controlVariants> {}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, density, ...props }, ref) => {
    return <select ref={ref} className={cn(controlVariants({ density }), className)} {...props} />
  }
)
Select.displayName = 'Select'

export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement>, VariantProps<typeof controlVariants> {}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, density, ...props }, ref) => {
    return <textarea ref={ref} className={cn(controlVariants({ density }), className)} {...props} />
  }
)
Textarea.displayName = 'Textarea'

export type { ControlDensity, FieldDensity, FieldLabelTone }
