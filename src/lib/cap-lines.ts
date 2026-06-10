/**
 * Telegram hard-caps message text at 4096 chars — longer sends fail with
 * 400 "message is too long" (#298). We cap at 4000 to leave headroom.
 */
const DEFAULT_MAX_CHARS = 4000

/**
 * Joins `header` + `lines` with '\n', keeping the result under `maxChars`.
 * When lines don't fit, the tail is dropped and replaced with «…и ещё N» —
 * the same truncation pattern as the notifier's grouped 10-item cap.
 */
export function capLines(header: string, lines: string[], maxChars = DEFAULT_MAX_CHARS): string {
  const render = (kept: number): string => {
    const hidden = lines.length - kept
    const body = hidden > 0 ? [...lines.slice(0, kept), `…и ещё ${hidden}`] : lines
    return [header, ...body].join('\n')
  }

  let kept = lines.length
  let text = render(kept)
  while (kept > 0 && text.length > maxChars) {
    kept--
    text = render(kept)
  }
  return text
}
