/** Error de API con un código que la interfaz traduce a un mensaje entendible. */
export class ApiError extends Error {
  constructor(code, { status = 0, detail = '' } = {}) {
    super(detail || code);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function retryAfterMs(response, attempt) {
  const header = Number(response.headers?.get?.('Retry-After'));
  const seconds = Number.isFinite(header) && header > 0 ? Math.min(header, 30) : 2 ** attempt;
  return seconds * 1000;
}
