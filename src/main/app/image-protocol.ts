import { net, protocol } from 'electron'
import { pathToFileURL } from 'node:url'
import { IMAGE_SCHEME, imagePath } from '../modules/images/access'
import { favoriteImagePath } from '../modules/images/recipes'

export function registerImageProtocol(): void {
  protocol.handle(IMAGE_SCHEME, (req) => {
    const url = new URL(req.url)
    const name = decodeURIComponent(url.pathname.replace(/^\/+/, ''))
    const path = url.hostname === 'favorite' ? favoriteImagePath(name) : imagePath(name)
    if (!path) {
      return new Response('Not found', { status: 404 })
    }
    return net.fetch(pathToFileURL(path).toString())
  })
}
