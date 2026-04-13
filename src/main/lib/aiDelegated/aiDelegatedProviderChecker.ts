import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import type { AiDelegatedProviderStatus, AiMode } from '@shared/types'

// Shared `execFile` wrapper used to detect whether an external CLI is available locally.
const execFileAsync = promisify(execFile)
const IS_WINDOWS = process.platform === 'win32'

// Only delegated modes backed by a local CLI need an availability check.
const AI_DELEGATED_CLI_MAP: Partial<Record<AiMode, { cmd: string; hint: string }>> = {
  'claude-code': {
    cmd: 'claude',
    hint: 'Claude CLI not found — install via: npm i -g @anthropic-ai/claude-code'
  },
  copilot: {
    cmd: 'gh',
    hint: 'GitHub CLI not found — install from: https://cli.github.com'
  },
  codex: {
    cmd: 'codex',
    hint: 'Codex CLI not found — install via: npm i -g @openai/codex'
  }
}

export interface AiDelegatedProviderChecker {
  checkAvailability(mode: AiMode): Promise<AiDelegatedProviderStatus>
}

/**
 * Checks whether the external assistant selected by the user is callable from the host machine.
 * Modes without a CLI dependency are treated as available by default.
 */
export function createAiDelegatedProviderChecker(): AiDelegatedProviderChecker {
  return {
    async checkAvailability(mode: AiMode): Promise<AiDelegatedProviderStatus> {
      const entry = AI_DELEGATED_CLI_MAP[mode]
      if (!entry) return { available: true }

      // `where` is the Windows equivalent of `which`.
      const checkCmd = IS_WINDOWS ? 'where' : 'which'
      try {
        await execFileAsync(checkCmd, [entry.cmd], { timeout: 3000 })
        return { available: true }
      } catch {
        return { available: false, reason: entry.hint }
      }
    }
  }
}
