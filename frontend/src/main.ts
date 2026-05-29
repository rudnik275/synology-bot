import { createApp } from 'vue'
import App from './App.vue'
import { initTelegram } from './telegram'
import './styles/tokens.css'

initTelegram()
createApp(App).mount('#app')
