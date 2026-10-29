import type { ReverseModel } from '../../shared/reverse/types'
import { invoke } from './bridge'

export const reverseApi = {
  reverseStatus: (models?: ReverseModel[]) => invoke('reverse:status', models),
  reverseInstall: (models?: ReverseModel[]) => invoke('reverse:install', models),
  reverseImport: (models?: ReverseModel[]) => invoke('reverse:import', models),
  reverseCancel: () => invoke('reverse:cancel'),
  reverseRemove: (models?: ReverseModel[]) => invoke('reverse:remove', models),
  reverseAnalyze: (bytes: Uint8Array, models?: ReverseModel[]) =>
    invoke('reverse:analyze', bytes, models),
  reverseScore: (reference: number[], name: string) => invoke('reverse:score', reference, name),
}
