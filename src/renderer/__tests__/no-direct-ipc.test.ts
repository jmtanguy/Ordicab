import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

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

    if (fullPath.endsWith('.tsx') || fullPath.endsWith('.ts')) {
      files.push(fullPath)
    }
  }

  return files
}

describe('renderer IPC usage boundaries', () => {
  it('prevents direct window.ordicabAPI calls in UI components', () => {
    const componentFiles = [
      ...getFilesRecursively(join(process.cwd(), 'src/renderer/components')),
      ...getFilesRecursively(join(process.cwd(), 'src/renderer/features')),
      join(process.cwd(), 'src/renderer/App.tsx')
    ]

    for (const filePath of componentFiles) {
      const fileContent = readFileSync(filePath, 'utf8')
      expect(fileContent).not.toContain('window.ordicabAPI')
    }
  })

  it('keeps audited shell, onboarding, and settings copy out of JSX literals', () => {
    const auditedFiles = [
      join(process.cwd(), 'src/renderer/components/shell/AppShell.tsx'),
      join(process.cwd(), 'src/renderer/features/domain/DomainDashboard.tsx'),
      join(process.cwd(), 'src/renderer/features/onboarding/DomainOnboardingCard.tsx')
    ]
    const forbiddenLiterals = [
      'Foundation shell',
      'Ordicab workspace is ready',
      'Select your Ordicab domain folder',
      'Confirm domain change',
      'Application language',
      'English',
      'French'
    ]

    for (const filePath of auditedFiles) {
      const fileContent = readFileSync(filePath, 'utf8')

      for (const forbiddenLiteral of forbiddenLiterals) {
        expect(fileContent).not.toContain(forbiddenLiteral)
      }
    }
  })
})
