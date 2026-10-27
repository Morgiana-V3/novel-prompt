import { net, protocol } from 'electron'
import { pathToFileURL } from 'node:url'
import { IMAGE_SCHEME, imagePath } from '../modules/images/access'

export function registerImageProtocol(): void {
  protocol.handle(IMAGE_SCHEME, (req) => {
    const name = decodeURIComponent(new URL(req.url).pathname.replace(/^\/+/, ''))
    const path = imagePath(name)
    if (!path) {
      return new Response('Not found', { status: 404 })
    }
    return net.fetch(pathToFileURL(path).toString())
  })
}
