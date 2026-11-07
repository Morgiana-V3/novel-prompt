import { createApp } from 'vue'
import App from './app/App.vue'
import { installTooltips } from './shared/lib/tooltips'
import { installFocusModality } from './shared/lib/focus-modality'
import './style.css'

createApp(App).mount('#app')
const disposeTooltips = installTooltips()
import.meta.hot?.dispose(disposeTooltips)
const disposeFocusModality = installFocusModality()
import.meta.hot?.dispose(disposeFocusModality)
