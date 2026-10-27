import type { SkillConfigItem } from '@shared/skills/types'
import { reactive } from 'vue'

export const skillsState = reactive({
  /** 全部 Skill，按优先级排列，含启用状态 */
  skills: [] as SkillConfigItem[],

  /** 侧栏的 Skill 启用浮层是否打开 */
  skillPanel: false,
})

/* ---------- Skill ---------- */

/** 重新读取 Skill 列表（启用状态与优先级）；MCP 可能在后台改过，打开相关界面时调用 */
export async function loadSkills(): Promise<SkillConfigItem[]> {
  skillsState.skills = await window.api.skillsList()
  return skillsState.skills
}

/** 保存启用与优先级（传入完整列表，顺序即优先级） */
export async function saveSkillConfig(list: SkillConfigItem[]): Promise<void> {
  skillsState.skills = list
  skillsState.skills = await window.api.skillsSetConfig(
    list.map((skill) => ({ id: skill.id, enabled: skill.enabled })),
  )
}
