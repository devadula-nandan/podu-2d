/** Thrown when the AI is asked to choose from a position it cannot act in. */
export class AiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AiError';
  }
}
