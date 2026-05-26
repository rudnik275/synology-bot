/**
 * DeployReporter — one-shot startup check that announces image upgrades.
 *
 * Approach: on every boot, ask Docker for our own container's Image SHA and
 * compare with what we stored last time. Different SHA → Watchtower (or the
 * owner) just deployed a new image. Same SHA → plain restart, stay quiet.
 *
 * Why not scrape Watchtower's logs (the original plan)? Two reasons:
 * 1. Watchtower restarts the bot synchronously, so by the time the bot is
 *    alive again the deploy is already done. A startup check is the natural
 *    boundary, no polling needed.
 * 2. Watchtower's "Session done" log line lives or dies based on log level,
 *    formatter, and whether `WATCHTOWER_NOTIFICATION_REPORT` is on; image
 *    SHA is a hard fact we can observe directly.
 *
 * Failed deploys (Watchtower pulled image but bot crashes on start) are
 * implicitly handled by silence — the bot can't notify if it can't run. The
 * owner sees the absence and runs `/deploy-status` to investigate.
 */

export interface DeployReporterDeps {
  /** Returns the image SHA the current container was started from. */
  getOwnImageId: () => Promise<string>
  /** Last-seen image SHA from persistent storage; undefined on first run. */
  getLastImageId: () => string | undefined
  /** Persist the new image SHA for next boot. */
  setLastImageId: (sha: string) => void
  /** App version (from package.json) to include in the message. */
  version: string
  /** Send the deploy notification to the owner. */
  notify: (message: string) => Promise<void>
}

export class DeployReporter {
  constructor(private readonly deps: DeployReporterDeps) {}

  /**
   * Run the comparison once. Idempotent: subsequent calls with the same image
   * SHA are no-ops because the SHA was persisted.
   */
  async report(): Promise<void> {
    let currentSha: string
    try {
      currentSha = await this.deps.getOwnImageId()
    } catch (err) {
      console.warn('[DeployReporter] could not read own image SHA — skipping:', err)
      return
    }

    if (!currentSha) {
      console.warn('[DeployReporter] empty image SHA from docker — skipping')
      return
    }

    const lastSha = this.deps.getLastImageId()
    if (lastSha === undefined) {
      // First-ever startup or first run after migration — prime the baseline
      // silently. Otherwise the owner would get a "deploy" notification on
      // initial install, which is misleading.
      this.deps.setLastImageId(currentSha)
      console.log(`[DeployReporter] Primed baseline image SHA ${shortSha(currentSha)}`)
      return
    }

    if (lastSha === currentSha) {
      // Plain restart, no deploy. Stay quiet.
      return
    }

    const message = `🚀 Деплой: synology-bot v${this.deps.version}`
    await this.deps.notify(message)
    this.deps.setLastImageId(currentSha)
    console.log(
      `[DeployReporter] Deploy reported: ${shortSha(lastSha)} → ${shortSha(currentSha)} (v${this.deps.version})`
    )
  }
}

function shortSha(sha: string): string {
  return sha.replace(/^sha256:/, '').slice(0, 12)
}
