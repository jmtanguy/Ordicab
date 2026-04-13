import { mergeAttributes, Node } from '@tiptap/core'

import { buildTagToken, extractTagPath } from '@shared/templateContent'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    smartTag: {
      insertSmartTag: (path: string) => ReturnType
    }
  }
}

export const SmartTagExtension = Node.create<{ localizeTagPath: (path: string) => string }>({
  name: 'smartTag',

  addOptions() {
    return { localizeTagPath: (path: string) => path }
  },

  inline: true,
  group: 'inline',
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      path: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-template-tag-path') ?? '',
        renderHTML: (attributes) => ({
          'data-template-tag-path': extractTagPath(String(attributes.path ?? ''))
        })
      }
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-template-tag-path]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    const path = extractTagPath(String(node.attrs.path ?? ''))
    const displayPath = this.options.localizeTagPath(path)

    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        class: 'ord-template-tag-chip',
        contenteditable: 'false'
      }),
      buildTagToken(displayPath)
    ]
  },

  renderText({ node }) {
    return buildTagToken(String(node.attrs.path ?? ''))
  },

  addCommands() {
    return {
      insertSmartTag:
        (path) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: {
              path: extractTagPath(path)
            }
          })
    }
  }
})
