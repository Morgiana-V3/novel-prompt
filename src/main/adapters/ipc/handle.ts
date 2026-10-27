import type { IpcMainInvokeEvent } from 'electron'
import { ipcMain } from 'electron'
import type { IpcContract } from '../../../shared/contracts/api'

export function handle<TChannel extends keyof IpcContract>(
  channel: TChannel,
  handler: (
    event: IpcMainInvokeEvent,
    ...args: IpcContract[TChannel]['args']
  ) => IpcContract[TChannel]['result'] | Promise<IpcContract[TChannel]['result']>,
): void {
  ipcMain.handle(channel, handler)
}
