import type { ReachabilityResult } from '../infra/synology/types.ts'

export type NasState = 'reachable' | 'unreachable'

export type NasEvent = 'nas.down' | 'nas.recovered'

export interface ReachabilityMonitorOptions {
  /** Number of consecutive failures before transitioning to unreachable (default: 3) */
  debounceCount?: number
}

export interface ReachabilityMonitorDeps {
  checkReachability: () => Promise<ReachabilityResult>
  onEvent: (event: NasEvent, reason?: string) => Promise<void>
  getState: () => NasState
  setState: (state: NasState) => void
}

/**
 * ReachabilityMonitor wraps a reachability check with a failure counter.
 * - On success: reset counter; if state was unreachable, emit 'nas.recovered'
 * - On failure: increment counter; if counter reaches debounceCount and state
 *   is reachable, emit 'nas.down'. While unreachable, further failures are silent.
 */
export class ReachabilityMonitor {
  private failureCount = 0
  private readonly debounceCount: number
  private readonly deps: ReachabilityMonitorDeps

  constructor(deps: ReachabilityMonitorDeps, options: ReachabilityMonitorOptions = {}) {
    this.deps = deps
    this.debounceCount = options.debounceCount ?? 3
  }

  async poll(): Promise<void> {
    const result = await this.deps.checkReachability()
    const currentState = this.deps.getState()

    if (result.ok) {
      this.failureCount = 0
      if (currentState === 'unreachable') {
        this.deps.setState('reachable')
        await this.deps.onEvent('nas.recovered')
      }
    } else {
      this.failureCount++
      if (currentState === 'reachable' && this.failureCount >= this.debounceCount) {
        this.deps.setState('unreachable')
        await this.deps.onEvent('nas.down', result.reason)
      }
      // While already unreachable: silence subsequent failures
    }
  }
}
