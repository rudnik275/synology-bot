import type { Bot, Context } from 'grammy'
import type { SynologyClient } from '../../infra/synology/client.ts'
import type { SystemUtilization, StorageInfo, DiskInfo, ProcessGroupSlice } from '../../infra/synology/types.ts'
import { formatBytes, formatBytesPair } from '../../lib/format-size.ts'

type QueryResult<T> = { ok: true; data: T } | { ok: false; reason: string }

const TOP_RAM_LIMIT = 3
const TOP_CPU_LIMIT = 3
const CPU_REPORT_THRESHOLD = 0.5 // % — quieter than this isn't worth listing
const RAM_REPORT_THRESHOLD_BYTES = 5 * 1024 * 1024 // 5 MB — skip tiny daemons

/**
 * Pick the human-readable label for a slice. DSM sometimes returns an empty
 * `name` for low-level systemd slices (e.g. `syno_dsm_internal.slice`);
 * fall back to a cleaned-up `unit_name`. We strip the `.slice` suffix,
 * drop the `syno_` prefix that DSM uses for its own services, and
 * replace `_` with space so the label reads naturally in Telegram.
 */
function sliceLabel(s: ProcessGroupSlice): string {
  if (s.name && s.name.trim() !== '') return s.name
  return s.unit_name
    .replace(/\.slice$/, '')
    .replace(/^syno_/, '')
    .replace(/_/g, ' ')
}

function topRamLines(slices: ProcessGroupSlice[], limit: number): string[] {
  return [...slices]
    .filter((s) => s.memory >= RAM_REPORT_THRESHOLD_BYTES)
    .sort((a, b) => b.memory - a.memory)
    .slice(0, limit)
    .map((s) => `      • ${sliceLabel(s)} — ${formatBytes(s.memory)}`)
}

function topCpuLines(slices: ProcessGroupSlice[], limit: number): string[] {
  return [...slices]
    .filter((s) => s.cpu_utilization >= CPU_REPORT_THRESHOLD)
    .sort((a, b) => b.cpu_utilization - a.cpu_utilization)
    .slice(0, limit)
    .map((s) => `      • ${sliceLabel(s)} — ${s.cpu_utilization.toFixed(1)}%`)
}

// ─── Pure formatter (exported for tests) ────────────────────────────────────

export function formatHealthMessage(
  utilResult: QueryResult<SystemUtilization>,
  storageResult: QueryResult<StorageInfo>,
  diskResult: QueryResult<DiskInfo>,
  processGroups: ProcessGroupSlice[] = [],
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
    const cpuPct = u.cpu.user_load + u.cpu.system_load
    const ramPct = u.memory.real_usage
    // DSM gives memory in KB; convert to bytes so formatBytesPair can do
    // the unit selection (matches what the rest of the bot uses).
    const totalBytes = u.memory.total_real * 1024
    // Derive used bytes from real_usage so it matches the displayed percent
    // (avoids the avail_real-includes-cache trap, see types.ts).
    const usedBytes = (totalBytes * ramPct) / 100
    lines.push(`🖥 CPU: ${cpuPct}% • RAM: ${formatBytesPair(usedBytes, totalBytes)} (${ramPct}%)`)

    if (processGroups.length > 0) {
      const ramTop = topRamLines(processGroups, TOP_RAM_LIMIT)
      if (ramTop.length > 0) {
        lines.push('   Топ RAM:')
        lines.push(...ramTop)
      }
      const cpuTop = topCpuLines(processGroups, TOP_CPU_LIMIT)
      if (cpuTop.length > 0) {
        lines.push('   Топ CPU:')
        lines.push(...cpuTop)
      }
    }
  }

  lines.push('')

  // ── Storage ────────────────────────────────────────────────────────────────
  if (!storageResult.ok) {
    lines.push(`💽 Хранилище: ❌ ${storageResult.reason}`)
  } else {
    lines.push('💽 Хранилище:')
    for (const vol of storageResult.data.volumes) {
      const total = Number(vol.size.total)
      const used = Number(vol.size.used)
      const pct = Math.round((used / total) * 100)
      const statusEmoji = vol.status === 'crashed' ? '❌' : pct >= 90 ? '⚠️' : '✅'
      lines.push(`  • ${vol.vol_path}: ${formatBytesPair(used, total)} (${pct}%) ${statusEmoji}`)
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
    const [utilResult, storageResult, diskResult, processGroupsResult] = await Promise.all([
      synology.getSystemUtilization(),
      synology.getStorageInfo(),
      synology.getDiskInfo(),
      synology.getProcessGroups(),
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

    const processGroups = processGroupsResult.ok ? processGroupsResult.data : []
    const message = formatHealthMessage(utilResult, storageResult, diskResult, processGroups)
    await ctx.reply(message)
  })
}
