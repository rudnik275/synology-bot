/**
 * runPollingLoop — supervised interval loop used by the four app.ts watchers.
 *
 * Runs `tick` once every `intervalMs` milliseconds. If `tick` throws, the
 * error is caught, logged to console.error (tagged with `name`), and the loop
 * continues. Call `stop()` on the returned handle to halt the loop.
 *
 * The optional `_sleep` parameter injects a custom sleep function; in
 * production the default (real setTimeout) is used. Tests inject a FakeSleep
 * so intervals can be driven manually without wall-clock waits.
 */

export interface PollingLoopHandle {
  stop: () => void
}

export interface RunPollingLoopOptions {
  intervalMs: number
  tick: () => Promise<void>
  name: string
  /** Injectable sleep — defaults to a real setTimeout-based promise. */
  _sleep?: (ms: number) => Promise<void>
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function runPollingLoop({
  intervalMs,
  tick,
  name,
  _sleep = defaultSleep,
}: RunPollingLoopOptions): PollingLoopHandle {
  let stopped = false

  const loop = async (): Promise<void> => {
    while (!stopped) {
      await _sleep(intervalMs)
      if (stopped) break
      try {
        await tick()
      } catch (err) {
        console.error(`[${name}] Unexpected error in poll:`, err)
      }
    }
  }

  loop().catch((err) => console.error(`[${name}] Loop crashed:`, err))

  return {
    stop: () => { stopped = true },
  }
}
