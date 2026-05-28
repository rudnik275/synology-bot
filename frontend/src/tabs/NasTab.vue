<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { api } from '../api'
import { formatBytes } from '../format'
import type { HealthView } from '../types'

const health = ref<HealthView | null>(null)
const loading = ref(true)
const error = ref<string | null>(null)

async function load() {
  loading.value = true
  error.value = null
  try {
    health.value = await api.health()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

function sectionError(section: string): string | undefined {
  return health.value?.errors.find((e) => e.section === section)?.reason
}

onMounted(load)
</script>

<template>
  <div v-if="loading" class="state">Loading…</div>
  <div v-else-if="error" class="state">
    <div class="error-banner">{{ error }}</div>
    <button @click="load">Retry</button>
  </div>

  <template v-else-if="health">
    <!-- CPU & memory -->
    <section class="card">
      <h2 class="card-title">CPU &amp; Memory</h2>
      <template v-if="health.cpu && health.memory">
        <div class="row">
          <span>CPU</span>
          <span class="value">{{ health.cpu.userLoad }}% user · {{ health.cpu.systemLoad }}% sys</span>
        </div>
        <div class="row">
          <span>RAM</span>
          <span class="value">
            {{ formatBytes(health.memory.usedBytes) }} / {{ formatBytes(health.memory.totalBytes) }} ({{ health.memory.pct }}%)
          </span>
        </div>
        <div class="progress"><span :style="{ width: health.memory.pct + '%' }" /></div>
      </template>
      <p v-else class="hint">{{ sectionError('utilization') ?? 'Unavailable' }}</p>
    </section>

    <!-- Volumes -->
    <section class="card">
      <h2 class="card-title">Volumes</h2>
      <template v-if="health.volumes">
        <div v-for="vol in health.volumes" :key="vol.path">
          <div class="row">
            <span><span class="status-dot" :class="'status-' + vol.status" />{{ vol.path }}</span>
            <span class="value">
              {{ formatBytes(vol.usedBytes) }} / {{ formatBytes(vol.totalBytes) }} ({{ vol.pct }}%)
            </span>
          </div>
          <div class="progress"><span :style="{ width: vol.pct + '%' }" /></div>
        </div>
        <p v-if="health.volumes.length === 0" class="hint">No volumes reported</p>
      </template>
      <p v-else class="hint">{{ sectionError('storage') ?? 'Unavailable' }}</p>
    </section>

    <!-- Disks -->
    <section class="card">
      <h2 class="card-title">Disks</h2>
      <template v-if="health.disks">
        <div v-for="(disk, i) in health.disks" :key="i" class="row">
          <span><span class="status-dot" :class="'status-' + disk.tempStatus" />{{ disk.model }}</span>
          <span class="value">{{ disk.tempC }}°C · {{ disk.smart }}</span>
        </div>
        <p v-if="health.disks.length === 0" class="hint">No disks reported</p>
      </template>
      <p v-else class="hint">{{ sectionError('disks') ?? 'Unavailable' }}</p>
    </section>

    <!-- Top processes -->
    <section class="card">
      <h2 class="card-title">Top processes</h2>
      <template v-if="health.processes">
        <div class="row hint"><span>By RAM</span><span /></div>
        <div v-for="(p, i) in health.processes.topRam" :key="'r' + i" class="row">
          <span>{{ p.name }}</span><span class="value">{{ formatBytes(p.bytes) }}</span>
        </div>
        <div class="row hint" style="margin-top: 8px"><span>By CPU</span><span /></div>
        <div v-for="(p, i) in health.processes.topCpu" :key="'c' + i" class="row">
          <span>{{ p.name }}</span><span class="value">{{ p.pct }}%</span>
        </div>
      </template>
      <p v-else class="hint">{{ sectionError('processGroups') ?? 'Unavailable' }}</p>
    </section>
  </template>
</template>
