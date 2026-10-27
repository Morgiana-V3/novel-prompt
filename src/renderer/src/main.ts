import { createApp } from 'vue'
import App from './app/App.vue'
import { installTooltips } from './shared/lib/tooltips'
import './style.css'

createApp(App).mount('#app')
const disposeTooltips = installTooltips()
import.meta.hot?.dispose(disposeTooltips)
