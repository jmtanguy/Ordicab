import { useEffect, useRef, useState } from 'react'

import { cn } from '@renderer/lib/utils'

export interface ComboOption {
  label: string
  value: string
}

/**
 * Free-text input with a styled dropdown of preset suggestions. Used by
 * GenerateDocumentPanel for the per-tag value editors so the user can either
 * type a custom value or pick from a list (key-date variants, key-reference
 * values, etc.).
 *
 * With `type="date"` the input becomes a native day picker (value must be ISO
 * YYYY-MM-DD) and the suggestions open via a dedicated chevron button instead
 * of focus, so the native calendar and the list don't fight each other.
 */
export function ComboField({
  value,
  onChange,
  options,
  placeholder,
  inputClassName,
  type = 'text'
}: {
  value: string
  onChange: (v: string) => void
  options: ComboOption[]
  placeholder?: string
  inputClassName?: string
  type?: 'text' | 'date'
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const isDate = type === 'date'

  // Close on outside click
  useEffect(() => {
    function handleMouseDown(e: MouseEvent): void {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [])

  return (
    <div ref={wrapperRef} className="relative">
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={isDate ? undefined : () => setOpen(true)}
        placeholder={placeholder}
        className={cn(inputClassName, isDate && options.length > 0 ? 'pr-9' : undefined)}
      />
      {isDate && options.length > 0 ? (
        <button
          type="button"
          aria-label="Suggestions"
          onClick={() => setOpen((prev) => !prev)}
          className="absolute inset-y-0 right-2 flex items-center text-ink-muted transition hover:text-ink"
        >
          <svg
            className={`size-4 transition-transform ${open ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      ) : null}
      {open && options.length > 0 ? (
        <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-xl border border-hairline bg-parchment shadow-[0_8px_24px_rgba(0,0,0,0.12)]">
          {options.map((opt) => (
            <li key={opt.value}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault() // prevent input blur before click
                  onChange(opt.value)
                  setOpen(false)
                }}
                className={cn(
                  'flex w-full items-center justify-between gap-3 px-4 py-2 text-left text-sm transition hover:bg-parchment-dim',
                  opt.value === value ? 'text-aurora' : 'text-ink'
                )}
              >
                <span className="font-medium">{opt.label}</span>
                <span className="shrink-0 font-mono text-xs text-ink-muted">{opt.value}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
