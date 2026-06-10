<script setup lang="ts">
// Settings sheet (#305) — runtime-tunable watcher thresholds + digest hour,
// reachable from the NAS section. Values load from GET /api/settings (KV
// overrides over env defaults) and save via PUT; watchers pick the new values
// up on their next tick, no redeploy. Validation mirrors the server's ranges
// so errors show inline before the request is even sent.
import { ref, watch } from 'vue'
import Sheet from './ui/Sheet.vue'
import Button from './ui/Button.vue'
import LoadingText from './ui/LoadingText.vue'
import { api } from '../api'
import type { SettingsView } from '../types'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ 'update:open': [boolean] }>()

type FieldKey = keyof SettingsView

interface FieldDef {
  key: FieldKey
  label: string
  unit: string
  min: number
  max: number
}

interface Group {
  title: string
  hint: string
  fields: FieldDef[]
}

// Ranges mirror SETTING_FIELDS in src/domain/settings.ts.
const GROUPS: Group[] = [
  {
    title: 'Заполнение диска',
    hint: 'Гистерезис: тревога при заполнении ≥ верхнего порога, отбой при < нижнего.',
    fields: [
      { key: 'diskUsageHighPct', label: 'Тревога от', unit: '%', min: 50, max: 99 },
      { key: 'diskUsageLowPct', label: 'Отбой ниже', unit: '%', min: 1, max: 98 },
    ],
  },
  {
    title: 'Температура дисков',
    hint: 'Перегрев шлёт тревогу; полоса между порогами — буфер без уведомлений.',
    fields: [
      { key: 'diskTempWarnC', label: 'Повышенная от', unit: '°C', min: 25, max: 80 },
      { key: 'diskTempBadC', label: 'Перегрев от', unit: '°C', min: 30, max: 90 },
    ],
  },
  {
    title: 'Дайджест',
    hint: 'Час отправки ежедневного дайджеста по подпискам (применится со следующего цикла).',
    fields: [{ key: 'digestHour', label: 'Час отправки', unit: '0–23', min: 0, max: 23 }],
  },
  {
    title: 'Автоочистка',
    hint: 'Завершённые задачи старше N дней удаляются из DownloadStation (файлы сохраняются).',
    fields: [{ key: 'autoCleanerRetentionDays', label: 'Хранить', unit: 'дней', min: 1, max: 60 }],
  },
]

const values = ref<Record<FieldKey, string>>({} as Record<FieldKey, string>)
const errors = ref<Partial<Record<FieldKey, string>>>({})
const loading = ref(false)
const loadError = ref('')
const saving = ref(false)
const saved = ref(false)
const saveError = ref('')
let savedTimer: ReturnType<typeof setTimeout> | null = null

async function load(): Promise<void> {
  loading.value = true
  loadError.value = ''
  errors.value = {}
  saveError.value = ''
  saved.value = false
  try {
    const settings = await api.settings()
    const next = {} as Record<FieldKey, string>
    for (const group of GROUPS) {
      for (const field of group.fields) next[field.key] = String(settings[field.key])
    }
    values.value = next
  } catch (err) {
    loadError.value = err instanceof Error ? err.message : 'Не удалось загрузить настройки'
  } finally {
    loading.value = false
  }
}

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) void load()
  },
  { immediate: true },
)

/** Parse + range-check every field; cross-field invariants mirror the server. */
function validate(): SettingsView | null {
  const fieldErrors: Partial<Record<FieldKey, string>> = {}
  const parsed = {} as SettingsView
  for (const group of GROUPS) {
    for (const field of group.fields) {
      // v-model on type="number" may hand back a number — normalize to string.
      const raw = String(values.value[field.key] ?? '').trim()
      const num = Number(raw)
      if (raw === '' || !Number.isInteger(num) || num < field.min || num > field.max) {
        fieldErrors[field.key] = `Целое число ${field.min}–${field.max}`
        continue
      }
      parsed[field.key] = num
    }
  }
  if (!fieldErrors.diskUsageHighPct && !fieldErrors.diskUsageLowPct && parsed.diskUsageLowPct >= parsed.diskUsageHighPct) {
    fieldErrors.diskUsageLowPct = 'Нижний порог должен быть меньше верхнего'
  }
  if (!fieldErrors.diskTempWarnC && !fieldErrors.diskTempBadC && parsed.diskTempWarnC >= parsed.diskTempBadC) {
    fieldErrors.diskTempWarnC = 'Порог «повышенная» должен быть ниже перегрева'
  }
  errors.value = fieldErrors
  return Object.keys(fieldErrors).length === 0 ? parsed : null
}

async function save(): Promise<void> {
  saveError.value = ''
  saved.value = false
  const patch = validate()
  if (!patch) return
  saving.value = true
  try {
    await api.saveSettings(patch)
    saved.value = true
    if (savedTimer) clearTimeout(savedTimer)
    savedTimer = setTimeout(() => { saved.value = false }, 2000)
  } catch (err) {
    saveError.value = err instanceof Error ? err.message : 'Не удалось сохранить'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <Sheet :open="open" title="Настройки" @update:open="emit('update:open', $event)">
    <LoadingText v-if="loading" label="Загрузка" />

    <p v-else-if="loadError" class="load-error" data-testid="settings-load-error">{{ loadError }}</p>

    <!-- novalidate: we render our own inline errors; the native browser bubble
         would fight the sheet (and blocks submit entirely in tests). -->
    <form v-else class="settings-form" novalidate @submit.prevent="save">
      <section v-for="group in GROUPS" :key="group.title" class="group">
        <p class="group-title">{{ group.title }}</p>
        <div class="rows">
          <div v-for="field in group.fields" :key="field.key" class="row">
            <label class="row-label" :for="`setting-${field.key}`">{{ field.label }}</label>
            <div class="row-input">
              <input
                :id="`setting-${field.key}`"
                v-model="values[field.key]"
                :data-testid="`settings-input-${field.key}`"
                class="num-input"
                :class="{ 'num-input--error': errors[field.key] }"
                type="number"
                inputmode="numeric"
                :min="field.min"
                :max="field.max"
                step="1"
              />
              <span class="unit">{{ field.unit }}</span>
            </div>
            <p v-if="errors[field.key]" class="field-error" :data-testid="`settings-error-${field.key}`">
              {{ errors[field.key] }}
            </p>
          </div>
        </div>
        <p class="group-hint">{{ group.hint }}</p>
      </section>

      <p v-if="saveError" class="load-error" data-testid="settings-save-error">{{ saveError }}</p>

      <Button type="submit" variant="primary" size="lg" data-testid="settings-save" :disabled="saving">
        {{ saving ? 'Сохранение…' : saved ? 'Сохранено ✓' : 'Сохранить' }}
      </Button>
    </form>
  </Sheet>
</template>

<style scoped>
.settings-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding-bottom: var(--space-2);
}

.group {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.group-title {
  margin: 0;
  font-size: var(--fs-xs);
  font-weight: var(--fw-bold);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  opacity: 0.5;
}

/* One flat panel per group; rows divided by hairlines (NAS-tab language). */
.rows {
  background: var(--paper);
  border: var(--border);
  border-radius: var(--radius);
  overflow: hidden;
}

.row {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  gap: var(--space-1) var(--space-2);
  padding: var(--space-2) var(--space-3);
}
.row + .row {
  border-top: var(--hairline);
}

.row-label {
  font-size: var(--fs-sm);
  font-weight: var(--fw-medium);
}

.row-input {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.num-input {
  width: 72px;
  min-height: 44px;
  padding: var(--space-1) var(--space-2);
  font-family: var(--font);
  font-size: var(--fs-md);
  font-weight: var(--fw-bold);
  font-variant-numeric: tabular-nums;
  text-align: right;
  color: var(--ink);
  background: var(--cream);
  border: var(--border);
  border-radius: var(--radius);
}
.num-input:focus {
  outline: 2px solid var(--ink);
  outline-offset: 1px;
}
.num-input--error {
  border-color: var(--red);
  background: var(--paper);
}

.unit {
  min-width: 34px;
  font-size: var(--fs-xs);
  font-weight: var(--fw-bold);
  opacity: 0.6;
}

.field-error {
  grid-column: 1 / -1;
  margin: 0;
  font-size: var(--fs-xs);
  font-weight: var(--fw-bold);
  color: var(--red);
}

.group-hint {
  margin: 0;
  font-size: var(--fs-xs);
  opacity: 0.55;
}

.load-error {
  margin: 0;
  font-size: var(--fs-sm);
  font-weight: var(--fw-bold);
  color: var(--red);
}
</style>
