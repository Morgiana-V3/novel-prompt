import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dataFile } from '../../infrastructure/paths'
import { writeFileAtomic } from '../../infrastructure/atomic-file'
import {
  DEFAULT_COLLECTION,
  type ImageCollections,
  type ImageCollection,
} from '../../../shared/images/collections'

/** Logical groups only: image paths and workspace ownership never change. */
export class CollectionStore {
  private state?: ImageCollections
  constructor(private path: () => string) {}
  private load(): ImageCollections {
    if (!this.state) {
      const file = this.path()
      if (existsSync(file)) {
        const value = JSON.parse(readFileSync(file, 'utf8')) as ImageCollections
        if (
          value.schema !== 1 ||
          !Array.isArray(value.collections) ||
          !value.assignments ||
          !value.collections.some((c) => c.id === DEFAULT_COLLECTION) ||
          value.collections.some((c) => typeof c.id !== 'string' || typeof c.name !== 'string')
        ) {
          throw new Error('图集数据损坏，请检查数据目录中的 image-collections.json')
        }
        this.state = value
      } else {
        this.state = {
          schema: 1,
          collections: [{ id: DEFAULT_COLLECTION, name: '默认图集', createdAt: Date.now() }],
          assignments: {},
        }
      }
    }
    return this.state
  }
  private save(next: ImageCollections): void {
    writeFileAtomic(this.path(), JSON.stringify(next))
    this.state = next
  }
  list(): ImageCollection[] {
    return structuredClone(this.load().collections)
  }
  resolve(id?: string): string {
    return this.load().collections.some((c) => c.id === id) ? id! : DEFAULT_COLLECTION
  }
  forImage(name: string): string {
    try {
      return this.resolve(this.load().assignments[name])
    } catch {
      // A damaged grouping index must not hide readable images or their recipes.
      return DEFAULT_COLLECTION
    }
  }
  create(name: string): ImageCollection {
    const next = structuredClone(this.load())
    const item = { id: randomUUID(), name: this.validName(name, next), createdAt: Date.now() }
    next.collections.push(item)
    this.save(next)
    return item
  }
  private validName(name: string, state: ImageCollections, id?: string): string {
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 40) {
      throw new Error('图集名称须为 1～40 个字符')
    }
    const value = name.trim()
    if (
      state.collections.some(
        (c) => c.id !== id && c.name.toLocaleLowerCase() === value.toLocaleLowerCase(),
      )
    ) {
      throw new Error('已有同名图集')
    }
    return value
  }
  rename(id: string, name: string): void {
    if (id === DEFAULT_COLLECTION) {
      throw new Error('默认图集不能改名')
    }
    const next = structuredClone(this.load())
    const item = next.collections.find((c) => c.id === id)
    if (!item) {
      throw new Error('图集不存在')
    }
    item.name = this.validName(name, next, id)
    this.save(next)
  }
  remove(id: string): void {
    if (id === DEFAULT_COLLECTION) {
      throw new Error('默认图集不能删除')
    }
    const next = structuredClone(this.load())
    next.collections = next.collections.filter((c) => c.id !== id)
    for (const name of Object.keys(next.assignments)) {
      if (next.assignments[name] === id) {
        delete next.assignments[name]
      }
    }
    this.save(next)
  }
  assign(names: string[], id: string): void {
    if (this.resolve(id) !== id) {
      throw new Error('图集不存在，请重新选择')
    }
    if (
      !Array.isArray(names) ||
      names.length > 10000 ||
      names.some(
        (name) => typeof name !== 'string' || !/^[\w.-]+\.png$/i.test(name) || name.includes('..'),
      )
    ) {
      throw new Error('图片标识无效')
    }
    const next = structuredClone(this.load())
    for (const name of names) {
      if (id === DEFAULT_COLLECTION) {
        delete next.assignments[name]
      } else {
        next.assignments[name] = id
      }
    }
    this.save(next)
  }
}
export const imageCollections = new CollectionStore(() => dataFile('image-collections.json'))
