import { reportError } from '../lib/notifications'

let viewers = 0
let restoreBackground: (() => void) | undefined

export function enterImagePreview(): () => void {
  if (viewers++ === 0) {
    const background = document.getElementById('app')
    const previous = background?.inert ?? false
    if (background) {
      background.inert = true
    }
    restoreBackground = () => {
      if (background) {
        background.inert = previous
      }
    }
    window.api.setImagePreviewActive(true).catch(reportError)
  }
  let released = false
  return () => {
    if (released) {
      return
    }
    released = true
    if (--viewers === 0) {
      restoreBackground?.()
      restoreBackground = undefined
      window.api.setImagePreviewActive(false).catch(reportError)
    }
  }
}
