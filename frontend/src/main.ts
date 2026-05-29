import { createApp } from 'vue'
import App from './App.vue'
import { initTelegram } from './telegram'

initTelegram()
createApp(App).mount('#app')
