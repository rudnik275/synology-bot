import type { Bot, Context } from 'grammy'
import type { SynologyClient } from '../../infra/synology/client.ts'
import type { SystemUtilization, StorageInfo, DiskInfo } from '../../infra/synology/types.ts'

type QueryResult<T> = { ok: true; data: T } | { ok: false; reason: string }

// ─── Pure formatter (exported for tests) ────────────────────────────────────

export function formatHealthMessage(
  utilResult: QueryResult<SystemUtilization>,
  storageResult: QueryResult<StorageInfo>,
  diskResult: QueryResult<DiskInfo>,
): string {
  const allFailed = !utilResult.ok && !storageResult.ok && !diskResult.ok
  if (allFailed) {
    const reason = !utilResult.ok ? utilResult.reason : 'недоступен'
    return `❌ NAS не отвечает — ${reason}`
  }

  const lines: string[] = ['🩺 Состояние NAS', '']

  // ── CPU / RAM ──────────────────────────────────────────────────────────────
  if (!utilResult.ok) {
    lines.push(`🖥 CPU / RAM: ❌ ${utilResult.reason}`)
  } else {
    const u = utilResult.data
    const cpuPct = u.cpu.user_load
    const totalGb = (u.memory.total_real / 1024 / 1024).toFixed(1)
    const usedGb = ((u.memory.total_real - u.memory.available_real) / 1024 / 1024).toFixed(1)
    const ramPct = u.memory.real_usage
    lines.push(`🖥 CPU: ${cpuPct}% • RAM: ${usedGb} / ${totalGb} GB (${ramPct}%)`)
  }

  lines.push('')

  // ── Storage ────────────────────────────────────────────────────────────────
  if (!storageResult.ok) {
    lines.push(`💽 Хранилище: ❌ ${storageResult.reason}`)
  } else {
    lines.push('💽 Хранилище:')
    for (const vol of storageResult.data.volumes) {
      const totalTb = (Number(vol.size.total) / 1024 / 1024 / 1024 / 1024).toFixed(1)
      const usedTb = (Number(vol.size.used) / 1024 / 1024 / 1024 / 1024).toFixed(1)
      const pct = Math.round((Number(vol.size.used) / Number(vol.size.total)) * 100)
      const statusEmoji = vol.status === 'crashed' ? '❌' : pct >= 90 ? '⚠️' : '✅'
      lines.push(`  • ${vol.name}: ${usedTb} / ${totalTb} TB (${pct}%) ${statusEmoji}`)
    }
  }

  lines.push('')

  // ── Disks ──────────────────────────────────────────────────────────────────
  if (!diskResult.ok) {
    lines.push(`🌡 Диски: ❌ ${diskResult.reason}`)
  } else {
    lines.push('🌡 Диски:')
    for (const disk of diskResult.data.disks) {
      const diskEmoji =
        disk.status === 'crashed' || disk.smart_status === 'failed'
          ? '❌'
          : disk.status === 'warning' || disk.smart_status === 'warning'
          ? '⚠️'
          : '✅'
      lines.push(`  • ${disk.model}: ${disk.temp}°C ${diskEmoji}`)
    }
  }

  return lines.join('\n')
}

// ─── Route registration ──────────────────────────────────────────────────────

export function registerHealthRoute(bot: Bot<Context>, synology: SynologyClient): void {
  bot.command('health', async (ctx) => {
    const [utilResult, storageResult, diskResult] = await Promise.all([
      synology.getSystemUtilization(),
      synology.getStorageInfo(),
      synology.getDiskInfo(),
    ])

    const allFailed = !utilResult.ok && !storageResult.ok && !diskResult.ok

    if (allFailed) {
      try {
        await ctx.react('👎')
      } catch {
        // Reaction API may not be available
      }
      const reason = !utilResult.ok ? utilResult.reason : 'недоступен'
      await ctx.reply(`❌ NAS не отвечает — ${reason}`)
      return
    }

    const message = formatHealthMessage(utilResult, storageResult, diskResult)
    await ctx.reply(message)
  })
}
