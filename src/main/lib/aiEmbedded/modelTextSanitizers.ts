// Shared sanitizers for raw model output, used both by the SDK provider
// middleware and the agent runtime's fallback parsers.

// Some models prepend hidden reasoning in <think> blocks. We strip it before
// displaying text or trying to parse it as JSON / a narrated tool request.
export function stripReasoningBlocks(raw: string): string {
  return raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
}
