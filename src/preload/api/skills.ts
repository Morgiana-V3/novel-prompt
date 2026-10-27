import type { SkillConfigItem, SkillDoc, SkillEntry, SkillInput } from '../../shared/skills/types'
import { invoke } from './bridge'

export const skillsApi = {
  skillsList: (): Promise<SkillConfigItem[]> => invoke('skills:list'),
  skillsGet: (id: string): Promise<SkillDoc | null> => invoke('skills:get', id),
  skillsCore: (): Promise<string> => invoke('skills:core'),
  skillsSetConfig: (entries: SkillEntry[]): Promise<SkillConfigItem[]> =>
    invoke('skills:setConfig', entries),
  skillsCreate: (input: SkillInput): Promise<SkillDoc> => invoke('skills:create', input),
  skillsUpdate: (id: string, patch: Partial<SkillInput>): Promise<SkillDoc> =>
    invoke('skills:update', id, patch),
  skillsDelete: (id: string): Promise<void> => invoke('skills:delete', id),
  skillsDuplicate: (id: string): Promise<SkillDoc> => invoke('skills:duplicate', id),
  skillsImport: (): Promise<{ imported: string[]; errors: string[] }> => invoke('skills:import'),
  skillsReveal: (id?: string): Promise<void> => invoke('skills:reveal', id),
}
