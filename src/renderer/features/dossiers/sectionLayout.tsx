import type { ReactNode } from 'react'

import { cn } from '@renderer/lib/utils'

interface SectionHeaderProps {
  badge: string
  count?: ReactNode
  actions?: ReactNode
}

export function SectionHeader({ badge, count, actions }: SectionHeaderProps): React.JSX.Element {
  return (
    <div className="flex min-h-10 shrink-0 flex-wrap items-center justify-between gap-3">
      <div className="flex items-baseline gap-3">
        <p className="text-xs uppercase tracking-[0.16em] text-[#5c5c5a]">{badge}</p>
        {count !== undefined && count !== null ? (
          <span className="text-xs text-[#8a8a85]">{count}</span>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  )
}

interface SearchFieldProps {
  id: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  ariaLabel?: string
  className?: string
}

export function SearchField({
  id,
  value,
  onChange,
  placeholder,
  ariaLabel,
  className
}: SearchFieldProps): React.JSX.Element {
  return (
    <div className={cn('relative min-w-48 flex-1', className)}>
      <svg
        aria-hidden="true"
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#8a8a85]"
        width="14"
        height="14"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      >
        <circle cx="7" cy="7" r="4.5" />
        <path d="m10.5 10.5 3 3" strokeLinecap="round" />
      </svg>
      <input
        id={id}
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel}
        className="h-10 w-full rounded-full border border-[#e5e3da] bg-white pl-9 pr-4 text-sm text-[#1a1a1a] outline-none transition placeholder:text-[#8a8a85] focus:border-aurora focus:ring-2 focus:ring-aurora/30"
      />
    </div>
  )
}

interface PillSelectProps<T extends string> {
  id: string
  value: T
  onChange: (value: T) => void
  ariaLabel?: string
  children: ReactNode
}

export function PillSelect<T extends string>({
  id,
  value,
  onChange,
  ariaLabel,
  children
}: PillSelectProps<T>): React.JSX.Element {
  return (
    <select
      id={id}
      value={value}
      onChange={(event) => onChange(event.target.value as T)}
      aria-label={ariaLabel}
      className="h-10 rounded-full border border-[#e5e3da] bg-white px-4 text-sm text-[#1a1a1a] outline-none transition focus:border-aurora focus:ring-2 focus:ring-aurora/30"
    >
      {children}
    </select>
  )
}

interface ListContainerProps {
  children: ReactNode
  className?: string
}

export function ListContainer({ children, className }: ListContainerProps): React.JSX.Element {
  return (
    <div
      className={cn(
        'min-h-0 flex-1 overflow-hidden rounded-2xl border border-[#e5e3da] bg-white shadow-[0_1px_2px_rgba(15,122,138,0.04)]',
        className
      )}
    >
      {children}
    </div>
  )
}

interface ColumnHeaderProps {
  children: ReactNode
}

export function ColumnHeader({ children }: ColumnHeaderProps): React.JSX.Element {
  return (
    <div className="flex h-9 items-center gap-3 border-b border-deep-space bg-[#fbf9f4] px-4 text-xs font-medium uppercase tracking-[0.12em] text-[#8a8a85]">
      {children}
    </div>
  )
}

interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label: string
  tone?: 'default' | 'danger'
  alwaysVisible?: boolean
  children: ReactNode
}

export function IconButton({
  label,
  tone = 'default',
  alwaysVisible = false,
  className,
  children,
  ...rest
}: IconButtonProps): React.JSX.Element {
  return (
    <button
      {...rest}
      type={rest.type ?? 'button'}
      aria-label={label}
      title={label}
      className={cn(
        'relative z-10 flex h-7 w-7 items-center justify-center rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aurora/40 disabled:pointer-events-none disabled:opacity-50',
        tone === 'danger'
          ? 'text-[#9c2f2f] hover:bg-[#fbf0f0]'
          : 'text-[#5c5c5a] hover:bg-aurora/10 hover:text-aurora',
        alwaysVisible
          ? 'opacity-100'
          : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
        className
      )}
    >
      {children}
    </button>
  )
}

export function PencilIcon(): React.JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M11.5 2.5 13.5 4.5 5 13 2.5 13.5 3 11Z" />
      <path d="M10 4 12 6" />
    </svg>
  )
}

export function TrashIcon(): React.JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 4.5h10" />
      <path d="M6.5 4.5V3h3v1.5" />
      <path d="M4.5 4.5 5 13.5h6L11.5 4.5" />
    </svg>
  )
}

export function ReceiptIcon(): React.JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 2.5h8v11l-2-1.2-2 1.2-2-1.2-2 1.2Z" />
      <path d="M6.5 5.5h3" />
      <path d="M6.5 8h3" />
      <path d="M6.5 10.5h2" />
    </svg>
  )
}

export function ArchiveIcon(): React.JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2.5 4.5h11" />
      <path d="M3.5 4.5 4.5 13h7l1-8.5" />
      <path d="M5 2.5h6l1.5 2h-9Z" />
      <path d="M6.5 8h3" />
    </svg>
  )
}

export function CopyIcon(): React.JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
      <path d="M10.5 5.5V3A1.5 1.5 0 0 0 9 1.5H3A1.5 1.5 0 0 0 1.5 3v6A1.5 1.5 0 0 0 3 10.5h2.5" />
    </svg>
  )
}

export function CheckIcon(): React.JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2.5 8.5 6.5 12.5 13.5 4" />
    </svg>
  )
}

interface DeleteConfirmTrayProps {
  label: string
  confirmLabel: string
  cancelLabel: string
  disabled?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function DeleteConfirmTray({
  label,
  confirmLabel,
  cancelLabel,
  disabled,
  onConfirm,
  onCancel
}: DeleteConfirmTrayProps): React.JSX.Element {
  return (
    <div className="relative z-10 flex w-max max-w-none flex-nowrap items-center gap-1.5 whitespace-nowrap rounded-full border border-[#e8c7c7] bg-[#fbf0f0] px-2 py-0.5">
      <span className="whitespace-nowrap text-xs font-semibold text-[#9c2f2f]">{label}</span>
      <button
        type="button"
        disabled={disabled}
        onClick={onConfirm}
        aria-label={confirmLabel}
        className="whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold text-[#9c2f2f] transition hover:bg-[#f7dada] disabled:opacity-50"
      >
        {confirmLabel}
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={onCancel}
        aria-label={cancelLabel}
        className="whitespace-nowrap rounded-full px-2 py-0.5 text-xs text-[#5c5c5a] transition hover:bg-white/60 hover:text-[#1a1a1a] disabled:opacity-50"
      >
        {cancelLabel}
      </button>
    </div>
  )
}
