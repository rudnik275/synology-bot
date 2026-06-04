// Pure base64 → File reconstruction for the bot-handoff path (#99, extracted #177).
//
// The bot stashes a forwarded .torrent's bytes as base64; the Mini App rebuilds a
// File from them so the add-flow can inspect/upload it like an in-app pick. Kept
// framework-free (no Vue, no Telegram) so it is trivially unit-testable.

/** Rebuild a File from the base64 payload the bot stashed (#99). */
export function base64ToFile(base64: string, name: string): File {
  const bin = atob(base64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new File([bytes], name, { type: 'application/x-bittorrent' })
}
