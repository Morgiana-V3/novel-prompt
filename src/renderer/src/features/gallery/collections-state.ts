import { ref } from 'vue'
import { DEFAULT_COLLECTION, type ImageCollection } from '@shared/images/collections'
export const collections = ref<ImageCollection[]>([
  { id: DEFAULT_COLLECTION, name: '默认图集', createdAt: 0 },
])
export const generationCollection = ref(
  localStorage.getItem('np-generation-collection') || DEFAULT_COLLECTION,
)
export function selectGenerationCollection(id: string): void {
  generationCollection.value = id
  localStorage.setItem('np-generation-collection', id)
}
export async function refreshCollections(): Promise<void> {
  collections.value = await window.api.collectionsList()
  if (!collections.value.some((c) => c.id === generationCollection.value)) {
    selectGenerationCollection(DEFAULT_COLLECTION)
  }
}
