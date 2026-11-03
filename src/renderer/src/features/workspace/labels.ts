/**
 * 版本标签的显示名：数据里（以及发给 AI 的上下文里）沿用「方案 V1 · 候选 1」，
 * 界面统一叫「版本」，避免同一个东西在画布、历史和对话里出现两种叫法。
 */
export const displayVersionLabel = (label: string) => label.replace(/^方案 (?=V\d)/, '版本 ')
