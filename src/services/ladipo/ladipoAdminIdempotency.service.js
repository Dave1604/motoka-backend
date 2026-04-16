/**
 * In-memory idempotency for Ladipo admin mutations (single-instance friendly).
 * Keys expire after TTL to bound memory.
 */

const store = new Map();
const inFlight = new Map();
const TTL_MS = 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 5000;

function prune() {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (entry.expiresAt < now) store.delete(key);
  }
  while (store.size > MAX_ENTRIES) {
    const first = store.keys().next().value;
    store.delete(first);
  }
  for (const [key, entry] of inFlight.entries()) {
    if (entry.expiresAt < now) inFlight.delete(key);
  }
  while (inFlight.size > MAX_ENTRIES) {
    const first = inFlight.keys().next().value;
    inFlight.delete(first);
  }
}

function fingerprintMismatchResponse() {
  return {
    status: 409,
    body: {
      status: false,
      code: 'IDEMPOTENCY_KEY_REUSE',
      message: 'Idempotency key was already used with a different request payload.',
    },
    replay: false,
    conflict: true,
  };
}

/**
 * @param {string} key
 * @param {() => Promise<{ status: number, body: object }>} executor
 * @param {{ fingerprint?: string }} [options]
 */
export async function withIdempotency(key, executor, options = {}) {
  if (!key || typeof key !== 'string' || key.length < 8) {
    const { status, body } = await executor();
    return { status, body, replay: false };
  }
  const fingerprint = typeof options.fingerprint === 'string' && options.fingerprint
    ? options.fingerprint
    : null;
  prune();
  const existing = store.get(key);
  if (existing && existing.expiresAt > Date.now()) {
    if (fingerprint && existing.fingerprint && existing.fingerprint !== fingerprint) {
      return fingerprintMismatchResponse();
    }
    return { status: existing.status, body: existing.body, replay: true };
  }
  const pending = inFlight.get(key);
  if (pending && pending.expiresAt > Date.now()) {
    if (fingerprint && pending.fingerprint && pending.fingerprint !== fingerprint) {
      return fingerprintMismatchResponse();
    }
    const result = await pending.promise;
    return { ...result, replay: true };
  }

  const promise = (async () => {
    const { status, body } = await executor();
    if (status >= 200 && status < 300) {
      store.set(key, {
        status,
        body,
        fingerprint,
        expiresAt: Date.now() + TTL_MS,
      });
    }
    return { status, body, replay: false };
  })();

  inFlight.set(key, {
    fingerprint,
    promise,
    expiresAt: Date.now() + TTL_MS,
  });

  try {
    return await promise;
  } finally {
    inFlight.delete(key);
  }
}
