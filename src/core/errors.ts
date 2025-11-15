export class PostlessError extends Error {
  constructor(message: string, public readonly code: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'PostlessError';
  }
}

export function friendlyNetworkError(error: unknown): PostlessError {
  if (error instanceof PostlessError) return error;
  const source = error as any;
  const code = source?.cause?.code ?? source?.code;
  const messages: Record<string, string> = {
    ENOTFOUND: 'DNS lookup failed: the host could not be found.',
    EAI_AGAIN: 'DNS lookup timed out. Check your network connection.',
    ECONNREFUSED: 'Connection refused: no server is accepting connections at this address.',
    ECONNRESET: 'The connection was reset by the server.',
    UND_ERR_CONNECT_TIMEOUT: 'Connection timed out before the server responded.',
    UND_ERR_HEADERS_TIMEOUT: 'The server timed out while sending response headers.',
    DEPTH_ZERO_SELF_SIGNED_CERT: 'TLS verification failed: the certificate is self-signed.',
    CERT_HAS_EXPIRED: 'TLS verification failed: the certificate has expired.',
    ERR_TLS_CERT_ALTNAME_INVALID: 'TLS verification failed: the certificate does not match the host.',
  };
  if (code && messages[code]) return new PostlessError(messages[code], code, error);
  if (source?.name === 'AbortError' || source?.name === 'TimeoutError') {
    return new PostlessError('Request timed out before a response was received.', 'TIMEOUT', error);
  }
  return new PostlessError(`Network request failed: ${source?.message ?? String(error)}`, code ?? 'NETWORK_ERROR', error);
}
