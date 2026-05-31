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
 */
export function ComboField({
  value,
  onChange,
  options,
  placeholder,
  inputClassName
}: {
  value: string
  onChange: (v: string) => void
  options: ComboOption[]
  placeholder?: string
  inputClassName?: string
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)

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
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        className={inputClassName}
      />
      {open && options.length > 0 ? (
        <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-xl border border-[#e5e3da] bg-[#f4f3ee] shadow-[0_8px_24px_rgba(0,0,0,0.12)]">
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
                  'flex w-full items-center justify-between gap-3 px-4 py-2 text-left text-sm transition hover:bg-[#e4e1d5]',
                  opt.value === value ? 'text-aurora' : 'text-[#1a1a1a]'
                )}
              >
                <span className="font-medium">{opt.label}</span>
                <span className="shrink-0 font-mono text-xs text-[#5c5c5a]">{opt.value}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
