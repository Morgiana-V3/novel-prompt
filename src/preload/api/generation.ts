import type {
  NaiFreeCheck,
  NaiGenParams,
  NaiGenRequest,
  NaiGenResult,
  NaiInpaintRequest,
  NaiSubscription,
  NaiVersion,
} from '../../shared/generation/types'
import type { ImageRecipe, NaiImage } from '../../shared/images/types'
import { invoke } from './bridge'

export const generationApi = {
  naiRetain: (name: string): Promise<NaiImage> => invoke('nai:retain', name),
  naiRecipe: (name: string): Promise<ImageRecipe | null> => invoke('nai:recipe', name),
  naiSubscription: (): Promise<NaiSubscription> => invoke('nai:subscription'),
  naiFreeCheck: (
    params: NaiGenParams,
    version: NaiVersion,
    sub?: NaiSubscription,
  ): Promise<NaiFreeCheck> => invoke('nai:freeCheck', params, version, sub),
  naiGenerate: (req: NaiGenRequest): Promise<NaiGenResult> => invoke('nai:generate', req),
  naiInpaint: (req: NaiInpaintRequest): Promise<NaiGenResult> => invoke('nai:inpaint', req),
  naiCancel: (): Promise<void> => invoke('nai:cancel'),
  naiList: (): Promise<NaiImage[]> => invoke('nai:list'),
  naiReadImage: (name: string): Promise<Uint8Array> => invoke('nai:readImage', name),
  naiSaveAs: (name: string): Promise<boolean> => invoke('nai:saveAs', name),
  naiCopyImage: (name: string): Promise<boolean> => invoke('nai:copyImage', name),
  naiReveal: (name?: string): Promise<void> => invoke('nai:reveal', name),
  naiDelete: (name: string): Promise<boolean> => invoke('nai:delete', name),
}
