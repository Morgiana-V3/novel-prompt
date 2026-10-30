import type { NaiGenRequest } from '../../shared/generation/types'
import type { SavedRecipe } from '../../shared/images/types'
import { invoke } from './bridge'

export const imagesApi = {
  recipesExport: (id: string): Promise<boolean> => invoke('recipes:export', id),
  recipesList: (): Promise<SavedRecipe[]> => invoke('recipes:list'),
  recipesCreate: (name: string): Promise<SavedRecipe> => invoke('recipes:create', name),
  recipesCreateConfig: (request: NaiGenRequest): Promise<SavedRecipe> =>
    invoke('recipes:config', request),
  recipesCreateWorkspace: (id: string, versionId: string): Promise<SavedRecipe> =>
    invoke('recipes:workspace', id, versionId),
  imagesCleanupStatus: (): Promise<{ pending: number; message: string }> =>
    invoke('images:cleanup-status'),
  imagesCleanupRetry: (): Promise<{ pending: number; message: string }> =>
    invoke('images:cleanup-retry'),
  recipesUpdate: (
    id: string,
    patch: Pick<SavedRecipe, 'name' | 'note' | 'tags'>,
  ): Promise<SavedRecipe> => invoke('recipes:update', id, patch),
  recipesDelete: (id: string): Promise<void> => invoke('recipes:delete', id),
}
