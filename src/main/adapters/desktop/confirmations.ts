import { randomUUID } from 'node:crypto'
import type { WebContents } from 'electron'
import type {
  ConfirmationOptions,
  ConfirmationRequest,
} from '../../../shared/contracts/confirmation'

const pending = new Map<
  string,
  { owner: WebContents; request: ConfirmationRequest; finish: (approved: boolean) => void }
>()
function publish(owner: WebContents) {
  if (!owner.isDestroyed() && !owner.isLoading()) {
    owner.send(
      'confirmations:changed',
      [...pending.values()].filter((item) => item.owner === owner).map((item) => item.request),
    )
  }
}
/** Only the requesting window can resolve its pending confirmation; no MCP tool exposes this. */
export function replyConfirmation(owner: WebContents, id: string, approved: boolean): void {
  const item = pending.get(id)
  if (!item || item.owner !== owner) {
    throw new Error('确认请求已失效')
  }
  item.finish(approved === true)
}
export function requestConfirmation(
  owner: WebContents,
  options: ConfirmationOptions,
  signal?: AbortSignal,
): Promise<boolean> {
  if (owner.isDestroyed() || signal?.aborted) {
    return Promise.resolve(false)
  }
  return new Promise((resolve) => {
    const id = randomUUID()
    let loaded = !owner.isLoading()
    const ready = () => {
      loaded = true
      publish(owner)
    }
    const cancel = () => finish(false)
    const navigate = (_event: unknown, _url: string, inPlace: boolean, mainFrame: boolean) => {
      if (loaded && mainFrame && !inPlace) {
        cancel()
      }
    }
    const finish = (approved: boolean) => {
      if (!pending.delete(id)) {
        return
      }
      signal?.removeEventListener('abort', cancel)
      owner.removeListener('destroyed', cancel)
      owner.removeListener('render-process-gone', cancel)
      owner.removeListener('did-fail-load', cancel)
      owner.removeListener('did-start-navigation', navigate)
      owner.removeListener('did-finish-load', ready)
      publish(owner)
      resolve(approved)
    }
    pending.set(id, { owner, request: { ...structuredClone(options), id }, finish })
    signal?.addEventListener('abort', cancel, { once: true })
    owner.once('destroyed', cancel)
    owner.once('render-process-gone', cancel)
    owner.once('did-fail-load', cancel)
    owner.on('did-start-navigation', navigate)
    owner.on('did-finish-load', ready)
    publish(owner)
  })
}
