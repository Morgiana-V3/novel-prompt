import { ipcRenderer } from 'electron'
import type { AppEvents, IpcContract, RendererMessages } from '../../shared/contracts/api'

export function invoke<TChannel extends keyof IpcContract>(
  channel: TChannel,
  ...args: IpcContract[TChannel]['args']
): Promise<IpcContract[TChannel]['result']> {
  return ipcRenderer.invoke(channel, ...args)
}
export function send<TChannel extends keyof RendererMessages>(
  channel: TChannel,
  ...args: RendererMessages[TChannel]
): void {
  ipcRenderer.send(channel, ...args)
}
export function on<TChannel extends keyof AppEvents>(
  channel: TChannel,
  callback: (payload: AppEvents[TChannel]) => void,
): () => void {
  const listener = (_event: Electron.IpcRendererEvent, payload: AppEvents[TChannel]) =>
    callback(payload)
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}
