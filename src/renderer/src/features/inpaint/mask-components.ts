/** Extract only the painted component under the pointer, preserving edge alpha.
 * Diagonal neighbours count as connected so thin brush strokes stay together.
 * This runs only when attaching a comment, never during pointer movement. */
export function splitMaskComponent(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
) {
  x = Math.floor(x)
  y = Math.floor(y)
  if (x < 0 || y < 0 || x >= width || y >= height || !data[(y * width + x) * 4 + 3]) {
    return null
  }
  const visited = new Uint8Array(width * height)
  const queue = new Uint32Array(width * height)
  const first = y * width + x
  queue[0] = first
  visited[first] = 1
  let head = 0
  let tail = 1
  while (head < tail) {
    const pixel = queue[head++]
    const px = pixel % width
    const py = Math.floor(pixel / width)
    for (let ny = Math.max(0, py - 1); ny <= Math.min(height - 1, py + 1); ny++) {
      for (let nx = Math.max(0, px - 1); nx <= Math.min(width - 1, px + 1); nx++) {
        const next = ny * width + nx
        if (!visited[next] && data[next * 4 + 3]) {
          visited[next] = 1
          queue[tail++] = next
        }
      }
    }
  }
  const component = new Uint8ClampedArray(data.length)
  const remainder = new Uint8ClampedArray(data)
  for (let i = 0; i < tail; i++) {
    const offset = queue[i] * 4
    for (let channel = 0; channel < 4; channel++) {
      component[offset + channel] = data[offset + channel]
      remainder[offset + channel] = 0
    }
  }
  let hasRemainder = false
  for (let i = 3; i < remainder.length; i += 4) {
    if (remainder[i]) {
      hasRemainder = true
      break
    }
  }
  return { component, remainder, hasRemainder }
}
