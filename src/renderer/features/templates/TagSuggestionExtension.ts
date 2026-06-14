import { Extension } from '@tiptap/core'
import { ReactRenderer } from '@tiptap/react'
import Suggestion, { type SuggestionProps } from '@tiptap/suggestion'

import {
  TagAutocompletePopup,
  type TagAutocompletePopupHandle,
  type TagSuggestionItem
} from './TagAutocompletePopup'

export interface TagSuggestionOptions {
  /** Returns the (already filtered/sorted) items for the current query. */
  getItems: (query: string) => TagSuggestionItem[]
  emptyLabel: string
}

function positionPopup(element: HTMLElement, clientRect: (() => DOMRect | null) | null): void {
  const rect = clientRect?.()
  if (!rect) return
  element.style.position = 'fixed'
  element.style.zIndex = '60'
  element.style.left = `${Math.min(rect.left, window.innerWidth - 400)}px`
  const popupHeight = element.offsetHeight || 288
  const fitsBelow = rect.bottom + popupHeight + 8 <= window.innerHeight
  element.style.top = fitsBelow
    ? `${rect.bottom + 4}px`
    : `${Math.max(8, rect.top - popupHeight - 4)}px`
}

/**
 * Typing `{{` in the editor opens a searchable tag autocomplete; selecting an
 * entry replaces the trigger text with a smartTag chip.
 */
export const TagSuggestionExtension = Extension.create<TagSuggestionOptions>({
  name: 'tagSuggestion',

  addOptions() {
    return {
      getItems: () => [],
      emptyLabel: ''
    }
  },

  addProseMirrorPlugins() {
    return [
      Suggestion<TagSuggestionItem>({
        editor: this.editor,
        char: '{{',
        allowSpaces: false,
        command: ({ editor, range, props }) => {
          editor.chain().focus().deleteRange(range).insertSmartTag(props.path).run()
        },
        items: ({ query }) => this.options.getItems(query),
        render: () => {
          let component: ReactRenderer<TagAutocompletePopupHandle> | null = null

          const destroy = (): void => {
            component?.element.remove()
            component?.destroy()
            component = null
          }

          return {
            onStart: (props: SuggestionProps<TagSuggestionItem>) => {
              component = new ReactRenderer(TagAutocompletePopup, {
                props: { ...props, emptyLabel: this.options.emptyLabel },
                editor: props.editor
              })
              document.body.appendChild(component.element)
              positionPopup(component.element as HTMLElement, props.clientRect ?? null)
            },
            onUpdate: (props: SuggestionProps<TagSuggestionItem>) => {
              component?.updateProps({ ...props, emptyLabel: this.options.emptyLabel })
              if (component) {
                positionPopup(component.element as HTMLElement, props.clientRect ?? null)
              }
            },
            onKeyDown: (props) => {
              if (props.event.key === 'Escape') {
                destroy()
                return true
              }
              return component?.ref?.onKeyDown(props) ?? false
            },
            onExit: () => {
              destroy()
            }
          }
        }
      })
    ]
  }
})
