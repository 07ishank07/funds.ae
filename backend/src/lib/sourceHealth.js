// Tracks the health of every source between runs (stored in data/feed-state.json).
// Circuit breaker: a source that fails repeatedly, or returns "not found",
// is paused for a while instead of being hammered every day.

export function stateFor(allState, sourceId) {
  allState.sources ||= {};
  allState.sources[sourceId] ||= { consecutiveFailures: 0, status: 'new' };
  return allState.sources[sourceId];
}

export function isPaused(state, now) {
  return Boolean(state.pausedUntil && new Date(state.pausedUntil) > now);
}

export function recordSuccess(state, now, extra = {}) {
  Object.assign(state, extra, {
    status: 'ok',
    consecutiveFailures: 0,
    lastError: null,
    pausedUntil: null,
    lastFetchedAt: now.toISOString(),
    lastSuccessAt: now.toISOString()
  });
}

export function recordFailure(state, err, now, settings) {
  const { maxConsecutiveFailures, pauseDays } = settings.circuitBreaker;
  state.consecutiveFailures = (state.consecutiveFailures || 0) + 1;
  state.lastFetchedAt = now.toISOString();
  state.lastFailureAt = now.toISOString();
  state.lastError = String(err?.message || err).slice(0, 300);
  state.status = 'error';
  const notFound = err?.status === 404 || err?.status === 410;
  if (notFound || state.consecutiveFailures >= maxConsecutiveFailures) {
    state.pausedUntil = new Date(now.getTime() + pauseDays * 86_400_000).toISOString();
    state.status = notFound ? 'not-found' : 'paused';
  }
}

export function resetState(allState, sourceId) {
  if (allState.sources?.[sourceId]) {
    allState.sources[sourceId] = { consecutiveFailures: 0, status: 'new' };
    return true;
  }
  return false;
}
