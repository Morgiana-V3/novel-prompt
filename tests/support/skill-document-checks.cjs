const assert = require('node:assert/strict')
const { posix } = require('node:path')

// Check rendered links, including cross-file anchors; filenames inside code are not links.
function checkSkillDocuments(files, render) {
  const rendered = new Map(
    [...files].map(([name, content]) => [name, render(content, { localLinks: true })]),
  )
  for (const [name, content] of files) {
    assert(
      !/(?:见\s*(?:参考资料\s*)?\d+(?:\.\d+)+|\d+\.\d+\s*节|第\s*[\d.]+\s*节)/.test(content),
      `${name}: stale numbered section reference`,
    )
    for (const match of rendered.get(name).matchAll(/<a href="([^"]+)"/g)) {
      const href = decodeURIComponent(match[1])
      if (/^[a-z]+:/i.test(href)) {
        continue
      }
      const [file, anchor] = href.split('#')
      const target = file ? posix.normalize(posix.join(posix.dirname(name), file)) : name
      assert(files.has(target), `${name}: missing ${href}`)
      if (anchor) {
        assert(rendered.get(target).includes(`id="${anchor}"`), `${name}: missing ${href}`)
      }
    }
  }
}

module.exports = { checkSkillDocuments }
