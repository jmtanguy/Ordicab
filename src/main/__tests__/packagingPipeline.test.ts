import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const testDir = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(testDir, '..', '..', '..')

function readProjectFile(relativePath: string): string {
  return readFileSync(resolve(projectRoot, relativePath), 'utf8')
}

describe('Story 1.5 packaging and release pipeline', () => {
  it('defines package scripts for CI and packaging', () => {
    const packageJson = JSON.parse(readProjectFile('package.json')) as {
      scripts?: Record<string, string>
    }
    const scripts = packageJson.scripts ?? {}

    expect(scripts['package']).toBeDefined()
    expect(scripts['package:mac']).toBeDefined()
    expect(scripts['package:win']).toBeDefined()
    expect(scripts['lint']).toBeDefined()
    expect(scripts['typecheck']).toBeDefined()
    expect(scripts['test']).toBeDefined()
  })

  it('stores electron-builder config at the repo root with required targets and updater publishing', () => {
    const configPath = resolve(projectRoot, 'electron-builder.config.ts')
    expect(existsSync(configPath)).toBe(true)

    const configText = readFileSync(configPath, 'utf8')
    expect(configText).toContain("target: 'dmg'")
    expect(configText).toContain("target: 'nsis'")
    expect(configText).toContain("target: 'zip'")
    expect(configText).toContain("arch: ['arm64']")
    expect(configText).toContain("arch: ['x64']")
    expect(configText).toContain('icon.icns')
    expect(configText).toContain('icon.ico')
    expect(configText).toContain("provider: 'github'")
  })

  it('adds CI workflow running lint, typecheck, and tests through npm scripts on pushes to main and PRs', () => {
    const ciWorkflow = readProjectFile('.github/workflows/ci.yml')

    expect(ciWorkflow).toContain('push:')
    expect(ciWorkflow).toContain('pull_request:')
    expect(ciWorkflow).toContain('- main')
    expect(ciWorkflow).toContain('npm run lint')
    expect(ciWorkflow).toContain('npm run typecheck')
    expect(ciWorkflow).toContain('npm run test')
  })

  it('adds release workflow for version tags that creates a GitHub release and uploads installer artifacts', () => {
    const releaseWorkflow = readProjectFile('.github/workflows/release.yml')

    expect(releaseWorkflow).toContain("tags: ['v*']")
    expect(releaseWorkflow).toContain('npm run package:mac')
    expect(releaseWorkflow).toContain('npm run package:win')
    expect(releaseWorkflow).toContain('softprops/action-gh-release')
    expect(releaseWorkflow).toContain('out/make')
  })

  it('workflow scripts reference package.json scripts that actually exist', () => {
    const packageJson = JSON.parse(readProjectFile('package.json')) as {
      scripts?: Record<string, string>
    }
    const scripts = packageJson.scripts ?? {}

    const ciWorkflow = readProjectFile('.github/workflows/ci.yml')
    const releaseWorkflow = readProjectFile('.github/workflows/release.yml')

    const ciScriptRefs = (ciWorkflow.match(/npm run (\S+)/g) ?? []).map((s) =>
      s.replace('npm run ', '')
    )
    const releaseScriptRefs = (releaseWorkflow.match(/npm run (\S+)/g) ?? []).map((s) =>
      s.replace('npm run ', '')
    )

    for (const scriptName of [...ciScriptRefs, ...releaseScriptRefs]) {
      expect(
        scripts[scriptName],
        `Workflow references 'npm run ${scriptName}' but it is not defined in package.json`
      ).toBeDefined()
    }
  })
})
