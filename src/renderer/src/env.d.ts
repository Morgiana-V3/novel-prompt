/// <reference types="vite/client" />
import type { Api } from '../../preload/index'

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<object, object, unknown>
  export default component
}

declare global {
  interface Window {
    api: Api
  }
}
