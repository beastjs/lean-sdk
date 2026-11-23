export const MAX_TIMER_DELAY = 2_147_483_647

/** Schedule a cancellable timer, splitting durations that exceed the host timer limit. */
export function scheduleTimeout(callback: () => void, delayMs: number): () => void {
  if (delayMs <= MAX_TIMER_DELAY) {
    const timer = setTimeout(callback, delayMs)
    return () => clearTimeout(timer)
  }

  const start = performance.now()
  let timer = setTimeout(tick, MAX_TIMER_DELAY)

  function tick(): void {
    const remaining = delayMs - (performance.now() - start)
    if (remaining <= 0) {
      callback()
      return
    }

    timer = setTimeout(tick, Math.min(MAX_TIMER_DELAY, Math.ceil(remaining)))
  }

  return () => clearTimeout(timer)
}
