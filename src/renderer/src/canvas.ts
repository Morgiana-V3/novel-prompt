import { createApp } from 'vue'
import CanvasWindow from './app/CanvasWindow.vue'
import { settingsState } from './features/settings/state'
import { installTooltips } from './shared/lib/tooltips'
import './shared/styles/variables.css'
import './shared/styles/base.css'
import './shared/styles/controls.css'
import './shared/styles/composer.css'
import './shared/styles/groups.css'
import './shared/styles/forms.css'
import './features/generation/styles/gallery.css'
import './features/prompts/styles/ai.css'
import './features/prompts/styles/preview.css'
import './features/prompts/styles/editor.css'
import './features/prompts/styles/tag-complete.css'
import './shared/styles/notifications.css'
import './shared/styles/motion.css'

if (typeof window.canvasApi?.getSettings === 'function') {
  void window.canvasApi
    .getSettings()
    .then((settings) => {
      settingsState.settings = settings
    })
    .catch(() => {})
}

createApp(CanvasWindow).mount('#app')
const disposeTooltips = installTooltips()
import.meta.hot?.dispose(disposeTooltips)
