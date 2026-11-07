'use strict';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };
const REDACT = /secret|password|token|signature|authorization|api[-_]?key/i;

function redact(v, depth = 0) {
  if (depth > 4 || v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map((x) => redact(x, depth + 1));
  const out = {};
  for (const [k, val] of Object.entries(v)) out[k] = REDACT.test(k) ? '[REDACTED]' : redact(val, depth + 1);
  return out;
}

// Logger JSON terstruktur satu baris per event; field sensitif otomatis disamarkan.
function createLogger({ level = 'info', sink = (line) => process.stdout.write(line + '\n'), base = {} } = {}) {
  const min = LEVELS[level] ?? LEVELS.info;
  const make = (b) => {
    const log = (lvl) => (msg, fields) => {
      if (LEVELS[lvl] < min) return;
      const rest = fields ? { ...fields } : {};
      const e = rest.err instanceof Error ? { name: rest.err.name, message: rest.err.message, code: rest.err.code } : undefined;
      delete rest.err;
      sink(JSON.stringify({ time: new Date().toISOString(), level: lvl, msg, ...b, ...redact(rest), ...(e ? { err: e } : {}) }));
    };
    return { debug: log('debug'), info: log('info'), warn: log('warn'), error: log('error'), child: (extra) => make({ ...b, ...extra }) };
  };
  return make(base);
}

module.exports = { createLogger };
