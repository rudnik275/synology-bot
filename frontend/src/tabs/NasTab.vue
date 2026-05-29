<script setup lang="ts">
// Live NAS health view (#70). Consumes the shared useHealth singleton
// so it shares the polling loop with the header chip.
import { computed } from 'vue'
import Card from '../components/Card.vue'
import { useHealth } from '../composables/useHealth'
import { formatBytes } from '../format'

const { data, loading, error } = useHealth()

/** Find the first error reason for a given section name. */
function sectionError(section: string): string | null {
  if (!data.value) return null
  return data.value.errors.find((e) => e.section === section)?.reason ?? null
}

/** POSIX basename — last non-empty path segment. */
function basename(path: string): string {
  const parts = path.split('/').filter(Boolean)
  return parts[parts.length - 1] ?? path
}

const cpu = computed(() => data.value?.cpu ?? null)
const memory = computed(() => data.value?.memory ?? null)
const volumes = computed(() => data.value?.volumes ?? null)
const disks = computed(() => data.value?.disks ?? null)
const processes = computed(() => data.value?.processes ?? null)
</script>

<template>
  <!-- Loading state -->
  <div v-if="loading && !data" class="nas-tab nas-loading" aria-busy="true">
    <Card>
      <span class="section-label">Loading…</span>
    </Card>
  </div>

  <!-- Network / auth error (no data at all) -->
  <div v-else-if="error && !data" class="nas-tab">
    <Card tone="red">
      <p class="section-label">Error</p>
      <p class="degraded-reason">{{ error }}</p>
    </Card>
  </div>

  <!-- Data present (possibly partial) -->
  <div v-else-if="data" class="nas-tab">

    <!-- CPU -->
    <Card class="nas-card">
      <p class="section-label">CPU</p>
      <div v-if="cpu" class="row-grid">
        <span class="row-key">User</span>
        <span class="row-val">{{ cpu.userLoad }}%</span>
        <span class="row-key">System</span>
        <span class="row-val">{{ cpu.systemLoad }}%</span>
      </div>
      <p v-else class="degraded-reason">{{ sectionError('cpu') ?? 'Unavailable' }}</p>
    </Card>

    <!-- RAM -->
    <Card class="nas-card">
      <p class="section-label">RAM</p>
      <div v-if="memory" class="row-grid">
        <span class="row-key">Used</span>
        <span class="row-val">{{ formatBytes(memory.usedBytes) }}</span>
        <span class="row-key">Total</span>
        <span class="row-val">{{ formatBytes(memory.totalBytes) }}</span>
        <span class="row-key">Usage</span>
        <span class="row-val">{{ memory.pct }}%</span>
      </div>
      <p v-else class="degraded-reason">{{ sectionError('memory') ?? 'Unavailable' }}</p>
    </Card>

    <!-- Volumes -->
    <template v-if="volumes">
      <Card v-for="vol in volumes" :key="vol.path" class="nas-card">
        <p class="section-label">Volume: {{ basename(vol.path) }}</p>
        <div class="row-grid">
          <span class="row-key">Used</span>
          <span class="row-val">{{ formatBytes(vol.usedBytes) }}</span>
          <span class="row-key">Total</span>
          <span class="row-val">{{ formatBytes(vol.totalBytes) }}</span>
          <span class="row-key">Usage</span>
          <span class="row-val">{{ vol.pct }}%</span>
          <span class="row-key">Status</span>
          <span class="row-val">{{ vol.status }}</span>
        </div>
      </Card>
    </template>
    <Card v-else class="nas-card" tone="orange">
      <p class="section-label">Volumes</p>
      <p class="degraded-reason">{{ sectionError('storage') ?? sectionError('volumes') ?? 'Unavailable' }}</p>
    </Card>

    <!-- Disks -->
    <template v-if="disks">
      <Card v-for="disk in disks" :key="disk.model" class="nas-card">
        <p class="section-label">Disk: {{ disk.model }}</p>
        <div class="row-grid">
          <span class="row-key">Temp</span>
          <span class="row-val">{{ disk.tempC }}°C ({{ disk.tempStatus }})</span>
          <span class="row-key">SMART</span>
          <span class="row-val">{{ disk.smart }}</span>
          <span class="row-key">Status</span>
          <span class="row-val">{{ disk.status }}</span>
        </div>
      </Card>
    </template>
    <Card v-else class="nas-card" tone="orange">
      <p class="section-label">Disks</p>
      <p class="degraded-reason">{{ sectionError('disks') ?? 'Unavailable' }}</p>
    </Card>

    <!-- Top processes -->
    <template v-if="processes">
      <Card class="nas-card">
        <p class="section-label">Top RAM</p>
        <div class="row-grid">
          <template v-for="proc in processes.topRam" :key="proc.name">
            <span class="row-key">{{ proc.name }}</span>
            <span class="row-val">{{ formatBytes(proc.bytes) }}</span>
          </template>
        </div>
      </Card>
      <Card class="nas-card">
        <p class="section-label">Top CPU</p>
        <div class="row-grid">
          <template v-for="proc in processes.topCpu" :key="proc.name">
            <span class="row-key">{{ proc.name }}</span>
            <span class="row-val">{{ proc.pct }}%</span>
          </template>
        </div>
      </Card>
    </template>
    <Card v-else class="nas-card" tone="orange">
      <p class="section-label">Processes</p>
      <p class="degraded-reason">{{ sectionError('processes') ?? 'Unavailable' }}</p>
    </Card>

  </div>

  <!-- No data, no loading, no error — shouldn't happen in practice -->
  <div v-else class="nas-tab">
    <Card>
      <p class="section-label">No data</p>
    </Card>
  </div>
</template>

<style scoped>
.nas-tab {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-4);
}
.nas-loading {
  opacity: 0.6;
}
.section-label {
  margin: 0 0 var(--space-2);
  font-size: var(--fs-sm);
  font-weight: var(--fw-bold);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.row-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-1) var(--space-3);
}
.row-key {
  font-size: var(--fs-sm);
  opacity: 0.7;
}
.row-val {
  font-size: var(--fs-sm);
  font-weight: var(--fw-bold);
  font-variant-numeric: tabular-nums;
}
.degraded-reason {
  margin: 0;
  font-size: var(--fs-sm);
  opacity: 0.8;
}
</style>
