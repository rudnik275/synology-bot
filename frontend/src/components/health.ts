// Health-chip status levels (ADR 0006). In a .ts module (not exported from
// HealthChip.vue) so useHealth.ts can import the type without resolving a
// `.vue` named export — vue-tsc falls back to the default-only `*.vue` shim on
// clean/Linux builds (see env.d.ts), breaking named type imports from SFCs.
export type HealthStatus = 'ok' | 'warn' | 'bad' | 'unknown'
