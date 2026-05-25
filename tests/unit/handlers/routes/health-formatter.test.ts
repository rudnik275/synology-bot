import { describe, it, expect } from 'bun:test'
import { formatHealthMessage } from '../../../../src/handlers/routes/health.ts'
import type { SystemUtilization, StorageInfo, DiskInfo } from '../../../../src/infra/synology/types.ts'

const utilizationData: SystemUtilization = {
  cpu: { user_load: 42, system_load: 8 },
  memory: { real_usage: 44, total_real: 16777216, avail_real: 9437184 },
}

const storageData: StorageInfo = {
  volumes: [
    {
      id: 'volume_1',
      vol_path: '/volume1',
      size: { total: '4398046511104', used: '1319413953331' },
      status: 'normal',
    },
    {
      id: 'volume_2',
      vol_path: '/volume2',
      size: { total: '4398046511104', used: '4178144185549' },
      status: 'normal',
    },
  ],
}

const diskData: DiskInfo = {
  disks: [
    { id: 'sata1', model: 'WDC WD40EFRX', temp: 38, temperature_status: 'normal', status: 'normal', smart_status: 'normal' },
    { id: 'sata2', model: 'ST4000VN008', temp: 41, temperature_status: 'normal', status: 'normal', smart_status: 'normal' },
  ],
}

describe('formatHealthMessage()', () => {
  it('formats a full success message in Russian with all three sections', () => {
    const msg = formatHealthMessage(
      { ok: true, data: utilizationData },
      { ok: true, data: storageData },
      { ok: true, data: diskData },
    )

    expect(msg).toContain('🩺 Состояние NAS')
    // CPU section
    expect(msg).toContain('🖥')
    expect(msg).toContain('CPU')
    expect(msg).toContain('42%')
    // RAM section — total_real 16777216 KB = 16 GB, available 9437184 KB = 9 GB → used ~ 7 GB, 44%
    expect(msg).toContain('RAM')
    expect(msg).toContain('44%')
    // Storage
    expect(msg).toContain('💽')
    expect(msg).toContain('/volume1')
    expect(msg).toContain('/volume2')
    // Disk
    expect(msg).toContain('🌡')
    expect(msg).toContain('WDC WD40EFRX')
    expect(msg).toContain('38°C')
    expect(msg).toContain('ST4000VN008')
    expect(msg).toContain('41°C')
  })

  it('marks volumes >= 90% used with ⚠️', () => {
    const msg = formatHealthMessage(
      { ok: true, data: utilizationData },
      { ok: true, data: storageData },
      { ok: true, data: diskData },
    )

    // Volume 2 is ~95% used
    const lines = msg.split('\n')
    const vol2Line = lines.find(l => l.includes('/volume2'))
    expect(vol2Line).toBeDefined()
    expect(vol2Line).toContain('⚠️')

    // Volume 1 is ~30% used — no warning
    const vol1Line = lines.find(l => l.includes('/volume1'))
    expect(vol1Line).toBeDefined()
    expect(vol1Line).not.toContain('⚠️')
  })

  it('marks normal disks with ✅', () => {
    const msg = formatHealthMessage(
      { ok: true, data: utilizationData },
      { ok: true, data: storageData },
      { ok: true, data: diskData },
    )

    const lines = msg.split('\n')
    const d1Line = lines.find(l => l.includes('WDC WD40EFRX'))
    expect(d1Line).toContain('✅')
  })

  it('marks crashed/warning disks with the proper emoji', () => {
    const crashedDiskData: DiskInfo = {
      disks: [
        { id: 'sata1', model: 'BadDisk', temp: 55, temperature_status: 'critical', status: 'crashed', smart_status: 'failed' },
      ],
    }

    const msg = formatHealthMessage(
      { ok: true, data: utilizationData },
      { ok: true, data: storageData },
      { ok: true, data: crashedDiskData },
    )

    const lines = msg.split('\n')
    const diskLine = lines.find(l => l.includes('BadDisk'))
    expect(diskLine).toContain('❌')
  })

  it('marks warning disks with ⚠️', () => {
    const warningDiskData: DiskInfo = {
      disks: [
        { id: 'sata1', model: 'WarnDisk', temp: 48, temperature_status: 'warning', status: 'warning', smart_status: 'warning' },
      ],
    }

    const msg = formatHealthMessage(
      { ok: true, data: utilizationData },
      { ok: true, data: storageData },
      { ok: true, data: warningDiskData },
    )

    const lines = msg.split('\n')
    const diskLine = lines.find(l => l.includes('WarnDisk'))
    expect(diskLine).toContain('⚠️')
  })

  it('shows failed section with ❌ reason when one query fails', () => {
    const msg = formatHealthMessage(
      { ok: false, reason: 'timeout' },
      { ok: true, data: storageData },
      { ok: true, data: diskData },
    )

    expect(msg).toContain('🩺 Состояние NAS')
    // CPU/RAM section should show error
    expect(msg).toContain('❌')
    expect(msg).toContain('timeout')
    // Storage and disks should still appear
    expect(msg).toContain('/volume1')
    expect(msg).toContain('WDC WD40EFRX')
  })

  it('shows failed storage section when storage query fails', () => {
    const msg = formatHealthMessage(
      { ok: true, data: utilizationData },
      { ok: false, reason: 'connection refused' },
      { ok: true, data: diskData },
    )

    expect(msg).toContain('💽')
    expect(msg).toContain('❌')
    expect(msg).toContain('connection refused')
    // CPU should still show
    expect(msg).toContain('42%')
  })

  it('returns all-failed short message when all three fail', () => {
    const msg = formatHealthMessage(
      { ok: false, reason: 'NAS offline' },
      { ok: false, reason: 'NAS offline' },
      { ok: false, reason: 'NAS offline' },
    )

    expect(msg).toContain('❌')
    expect(msg).toContain('NAS')
  })
})
