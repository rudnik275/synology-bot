import { createApp } from 'vue'
import App from './App.vue'
import { initTelegram } from './telegram'
import './styles/tokens.css'

// In dev, optionally serve the API from in-memory mocks so the whole design is
// viewable with no backend (`npm run dev`). The dynamic import + DEV guard keeps
// the ./mocks code out of production bundles entirely. Disable with `?mock=0`.
async function bootstrap(): Promise<void> {
  if (import.meta.env.DEV) {
    const { installMockApi } = await import('./mocks')
    installMockApi()
  }
  initTelegram()
  createApp(App).mount('#app')
}

void bootstrap()
