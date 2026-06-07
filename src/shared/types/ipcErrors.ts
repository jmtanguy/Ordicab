export enum IpcErrorCode {
  UNKNOWN = 'UNKNOWN',
  NOT_IMPLEMENTED = 'NOT_IMPLEMENTED',
  /** Schema/business-rule validation failed (e.g. Zod parse error on a payload). */
  VALIDATION_FAILED = 'VALIDATION_FAILED',
  FILE_SYSTEM_ERROR = 'FILE_SYSTEM_ERROR',
  NOT_FOUND = 'NOT_FOUND',
  /** Caller passed a value that violates a security or protocol constraint (e.g. disallowed URL protocol). */
  INVALID_INPUT = 'INVALID_INPUT',
  /** AI runtime (remote API) is not configured or not available. */
  AI_RUNTIME_UNAVAILABLE = 'AI_RUNTIME_UNAVAILABLE',
  /** AI response could not be parsed as valid JSON intent. */
  INTENT_PARSE_FAILED = 'INTENT_PARSE_FAILED',
  /** Remote AI provider returned an error. */
  REMOTE_API_ERROR = 'REMOTE_API_ERROR',
  /** OCR processing failed. */
  OCR_FAILED = 'OCR_FAILED',
  /** Managed cloud provider CLI is not installed or not authenticated. */
  CLOUD_PROVIDER_UNAVAILABLE = 'CLOUD_PROVIDER_UNAVAILABLE',
  /** Operation refused because referential or business-rule constraints would be violated (e.g. deleting an entity still referenced elsewhere). */
  INTEGRITY_CONFLICT = 'INTEGRITY_CONFLICT'
}
