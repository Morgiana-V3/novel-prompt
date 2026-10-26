import type { InpaintDraft, NaiGenParams } from './types'
import type { PageEditorState } from './page-workspace'

export interface WorkspaceConfigPatch { draft?: Partial<InpaintDraft>; params?: Partial<NaiGenParams>; strength?: number }
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)
/** Only configuration fields are writable; regions and frozen recipes have separate APIs. */
export function patchWorkspaceConfig(editor:PageEditorState, patch:WorkspaceConfigPatch, sizeLocked:boolean):PageEditorState {
  if(!object(patch)||Object.keys(patch).some(k=>!['draft','params','strength'].includes(k)))throw new Error('未知配置字段')
  const next:PageEditorState=JSON.parse(JSON.stringify(editor))
  if(patch.draft!==undefined){
    if(!object(patch.draft)||Object.keys(patch.draft).some(k=>!['base','negative','characters'].includes(k)))throw new Error('提示词字段无效')
    for(const key of ['base','negative'] as const)if(patch.draft[key]!==undefined){if(typeof patch.draft[key]!=='string'||patch.draft[key]!.length>60000)throw new Error('提示词过长或格式无效');next.draft[key]=patch.draft[key]!}
    if(patch.draft.characters!==undefined){
      if(!Array.isArray(patch.draft.characters)||patch.draft.characters.length>6||patch.draft.characters.some(c=>!object(c)||Object.keys(c).some(k=>!['prompt','negative','position'].includes(k))||typeof c.prompt!=='string'||typeof c.negative!=='string'||c.prompt.length>60000||c.negative.length>60000||(c.position!==undefined&&typeof c.position!=='string')))throw new Error('角色提示词格式无效')
      next.draft.characters=JSON.parse(JSON.stringify(patch.draft.characters))
    }
  }
  if(patch.params!==undefined){
    if(!object(patch.params))throw new Error('参数格式无效')
    const ranges:Record<string,[number,number,number?]>={width:[64,4096,64],height:[64,4096,64],steps:[1,50,1],scale:[0,10],cfgRescale:[0,1],seed:[0,4294967295,1]}
    for(const [k,v] of Object.entries(patch.params)){
      if(k==='count'){if(![1,2,4].includes(v as number))throw new Error('张数只能为 1、2 或 4');continue}
      if(k==='qualityTags'){if(typeof v!=='boolean')throw new Error('质量词开关无效');continue}
      if(k==='ucPreset'){if(!['heavy','light','human','none'].includes(v as string))throw new Error('UC 预设无效');continue}
      if((k==='width'||k==='height')&&sizeLocked&&v!==editor.params[k])throw new Error('已有遮罩或正在局部重绘，尺寸不可修改')
      if(k==='seed'&&(v===null||v===''))continue
      if(k==='sampler'){if(!['k_euler_ancestral','k_euler','k_dpmpp_2s_ancestral','k_dpmpp_2m_sde','k_dpmpp_2m','k_dpmpp_sde'].includes(String(v)))throw new Error('采样器无效')}
      else if(k==='noiseSchedule'){if(!['native','karras','exponential','polyexponential'].includes(String(v)))throw new Error('噪声调度无效')}
      else {const r=ranges[k];if(!r||typeof v!=='number'||!Number.isFinite(v)||v<r[0]||v>r[1]||(r[2]&&v%r[2]!==0))throw new Error('参数无效：'+k)}
    }
    Object.assign(next.params,patch.params)
  }
  if(patch.strength!==undefined){if(typeof patch.strength!=='number'||!Number.isFinite(patch.strength)||patch.strength<.01||patch.strength>1)throw new Error('重绘强度无效');next.strength=patch.strength}
  return next
}
