import type { DesktopCommand, DesktopReply, DesktopState } from '../../shared/contracts/desktop'
import { on, send } from './bridge'

export const desktopApi = {
  publishDesktop: (state: DesktopState): void => send('desktop:state', state),
  replyDesktop: (reply: DesktopReply): void => send('desktop:reply', reply),
  onDesktopCommand: (cb: (command: DesktopCommand) => void) => on('desktop:command', cb),
  cancelFrontend: (): void => send('desktop:cancel-frontend'),
  onFrontendCancel: (cb: (id: string) => void) => on('desktop:frontend-cancel', cb),
}
