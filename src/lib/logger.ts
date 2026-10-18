// Logs estructurados en JSON (Vercel y Railway los indexan). Redacta datos sensibles.
type Level = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<Level | 'silent', number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 };

const SENSITIVE = /pass(word)?|secret|token|api[_-]?key|authorization|cookie|service[_-]?role|email|phone|whatsapp/i;

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 5 || value == null) return value;
  if (value instanceof Error) return { name: value.name, message: redactString(value.message), stack: value.stack?.split('\n').slice(0, 6).join('\n') };
  if (typeof value === 'string') return redactString(value);
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) =>
      [k, SENSITIVE.test(k) ? '[redacted]' : redact(v, depth + 1)]));
  }
  return value;
}

function redactString(s: string) {
  return s
    .replace(/([?&](key|api_key|token|secret)=)[^&\s]+/gi, '$1[redacted]')
    .replace(/(postgres(ql)?:\/\/[^:\s]+:)[^@\s]+@/gi, '$1[redacted]@')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer [redacted]');
}

function write(level: Level, msg: string, data?: Record<string, unknown>) {
  const min = (process.env.LOG_LEVEL as Level | 'silent') || 'info';
  if (ORDER[level] < ORDER[min]) return;
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...(data ? (redact(data) as object) : {}) });
  (level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)(line);
}

export const log = {
  debug: (msg: string, data?: Record<string, unknown>) => write('debug', msg, data),
  info: (msg: string, data?: Record<string, unknown>) => write('info', msg, data),
  warn: (msg: string, data?: Record<string, unknown>) => write('warn', msg, data),
  error: (msg: string, data?: Record<string, unknown>) => write('error', msg, data),
};

/** Alerta a un webhook (Slack/Discord/Teams) si está configurado. Nunca lanza. */
export async function alert(title: string, details: Record<string, unknown> = {}) {
  log.error(`ALERTA: ${title}`, details);
  const url = process.env.ALERT_WEBHOOK_URL;
  if (!url) return;
  try {
    const text = `⚠️ GlobalTrade Connect (${process.env.APP_ENV || process.env.VERCEL_ENV || 'dev'}): ${title}\n${JSON.stringify(redact(details)).slice(0, 1500)}`;
    await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, content: text }), signal: AbortSignal.timeout(5000) });
  } catch (e) {
    log.warn('No se pudo enviar la alerta', { error: e });
  }
}
