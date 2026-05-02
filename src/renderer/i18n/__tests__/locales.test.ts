import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import ts from 'typescript'
import { describe, expect, it } from 'vitest'

import en from '@shared/i18n/locales/en.json'
import fr from '@shared/i18n/locales/fr.json'

function getFilesRecursively(rootPath: string): string[] {
  const entries = readdirSync(rootPath)
  const files: string[] = []

  for (const entry of entries) {
    const fullPath = join(rootPath, entry)
    const stats = statSync(fullPath)

    if (stats.isDirectory()) {
      files.push(...getFilesRecursively(fullPath))
      continue
    }

    if (fullPath.endsWith('.tsx') && !fullPath.endsWith('.test.tsx')) {
      files.push(fullPath)
    }
  }

  return files
}

describe('i18n locale resources', () => {
  it('keeps English and French key sets aligned', () => {
    expect(Object.keys(fr).sort()).toEqual(Object.keys(en).sort())
  })

  it('avoids hardcoded renderer text nodes in JSX components', () => {
    const componentFiles = [
      ...getFilesRecursively(join(process.cwd(), 'src/renderer/components')),
      ...getFilesRecursively(join(process.cwd(), 'src/renderer/features')),
      join(process.cwd(), 'src/renderer/App.tsx')
    ]

    for (const filePath of componentFiles) {
      const fileContent = readFileSync(filePath, 'utf8')
      const sourceFile = ts.createSourceFile(
        filePath,
        fileContent,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX
      )
      const hardcodedTextNodes: string[] = []

      function visit(node: ts.Node): void {
        if (ts.isJsxText(node) && /[A-Za-z]/.test(node.getText())) {
          hardcodedTextNodes.push(node.getText().trim())
        }

        node.forEachChild(visit)
      }

      visit(sourceFile)

      expect(hardcodedTextNodes).toEqual([])
    }
  })
})
