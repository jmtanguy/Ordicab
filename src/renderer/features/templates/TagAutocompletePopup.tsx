import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'

export interface TagSuggestionItem {
  /** Canonical tag path inserted into the document. */
  path: string
  /** Localized tag path shown as the main label. */
  label: string
  description: string
  example: string
  /** Localized group title used as a section header. */
  groupLabel: string
}

export interface TagAutocompletePopupHandle {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean
}

interface TagAutocompletePopupProps {
  items: TagSuggestionItem[]
  command: (item: TagSuggestionItem) => void
  emptyLabel: string
}

/**
 * Inline autocomplete list rendered by the `{{` suggestion plugin. The host
 * element is positioned by TagSuggestionExtension (fixed, from clientRect).
 */
export const TagAutocompletePopup = forwardRef<
  TagAutocompletePopupHandle,
  TagAutocompletePopupProps
>(function TagAutocompletePopup({ items, command, emptyLabel }, ref) {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const listRef = useRef<HTMLDivElement | null>(null)

  // Reset the highlight when the result list changes (adjust-state-during-render pattern).
  const [prevItems, setPrevItems] = useState(items)
  if (prevItems !== items) {
    setPrevItems(items)
    setSelectedIndex(0)
  }

  useEffect(() => {
    const selected = listRef.current?.querySelector('[data-selected="true"]')
    selected?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (event.key === 'ArrowDown') {
        setSelectedIndex((index) => (items.length === 0 ? 0 : (index + 1) % items.length))
        return true
      }
      if (event.key === 'ArrowUp') {
        setSelectedIndex((index) =>
          items.length === 0 ? 0 : (index - 1 + items.length) % items.length
        )
        return true
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        const item = items[selectedIndex]
        if (item) {
          command(item)
          return true
        }
        return false
      }
      return false
    }
  }))

  return (
    <div
      ref={listRef}
      className="max-h-72 w-96 overflow-y-auto rounded-xl border border-hairline bg-white py-1 shadow-xl"
    >
      {items.length === 0 ? (
        <p className="px-3 py-2 text-xs text-ink-muted">{emptyLabel}</p>
      ) : (
        items.map((item, index) => {
          const previousItem = index > 0 ? items[index - 1] : null
          const showGroupHeader = !previousItem || previousItem.groupLabel !== item.groupLabel
          const isSelected = index === selectedIndex
          return (
            <div key={item.path}>
              {showGroupHeader ? (
                <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-subtle">
                  {item.groupLabel}
                </p>
              ) : null}
              <button
                type="button"
                data-selected={isSelected ? 'true' : undefined}
                className={`flex w-full flex-col gap-0.5 px-3 py-1.5 text-left transition-colors ${
                  isSelected ? 'bg-aurora/10' : 'hover:bg-parchment-bright'
                }`}
                onMouseDown={(event) => {
                  // Keep the editor focused — mousedown would blur it before click fires.
                  event.preventDefault()
                  command(item)
                }}
                onMouseEnter={() => setSelectedIndex(index)}
              >
                <span className="font-mono text-xs text-aurora">{`{{${item.label}}}`}</span>
                <span className="text-xs text-ink-muted">
                  {item.description}
                  {item.example ? <span className="text-ink-subtle"> — {item.example}</span> : null}
                </span>
              </button>
            </div>
          )
        })
      )}
    </div>
  )
})
