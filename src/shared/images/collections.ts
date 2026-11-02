export const DEFAULT_COLLECTION = 'default'
export interface ImageCollection {
  id: string
  name: string
  createdAt: number
}
export interface ImageCollections {
  schema: 1
  collections: ImageCollection[]
  assignments: Record<string, string>
}
