// Modo diagnóstico: se activa abriendo la web con ?debug y registra lo que
// devuelven las APIs para poder investigar problemas reales.
import { session } from './storage.js';

export const APP_VERSION = '2026.11.23-3';

const MAX_LINES = 3000;

function isEnabled() {
  try {
    const params = new URLSearchParams(globalThis.location?.search ?? '');
    if (params.has('debug')) session.set('debug', params.get('debug') !== '0');
  } catch {
    /* sin location: tests */
  }
  return Boolean(session.get('debug'));
}

const lines = [];

export const diag = {
  enabled: isEnabled(),
  log(message) {
    if (!this.enabled) return;
    lines.push(`${new Date().toISOString().slice(11, 19)} ${message}`);
    if (lines.length > MAX_LINES) lines.shift();
  },
  text() {
    return [`versión ${APP_VERSION}`, `navegador ${globalThis.navigator?.userAgent ?? ''}`, ...lines].join('\n');
  },
};

/** Resumen corto de un error para el diagnóstico (nunca incluye tokens). */
export function describeError(error) {
  return `${error?.code ?? error?.name ?? 'error'}${error?.status ? ` ${error.status}` : ''}${error?.detail ? ` ${error.detail}` : ''}`;
}
