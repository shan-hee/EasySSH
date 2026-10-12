export class AIStreamConnectionError extends Error {
  constructor(message = "AI stream connection interrupted") {
    super(message)
    this.name = "AIStreamConnectionError"
  }
}
export function isRecoverableAIStreamError(error: unknown): boolean {
  return error instanceof AIStreamConnectionError
}
