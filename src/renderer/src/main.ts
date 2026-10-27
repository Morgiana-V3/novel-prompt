import { createApp } from 'vue'
import App from './App.vue'
import './style.css'
import { installTooltips } from './tooltips'

createApp(App).mount('#app')
const disposeTooltips = installTooltips()
import.meta.hot?.dispose(disposeTooltips)
