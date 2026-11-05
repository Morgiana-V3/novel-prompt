import type { ReverseModel, ReverseResult } from '../../../shared/reverse/types'

/**
 * 本地识图服务在应用宿主里只有一个实例（模型文件与识别进程互斥）。
 * IPC 注册时登记进来，界面与 Agent 共用同一个实例，避免两边同时占用模型。
 */
export interface ReverseRuntime {
  analyze: (
    bytes: Uint8Array,
    models: ReverseModel[] | undefined,
    report: (message: string) => void,
  ) => Promise<ReverseResult>
  cancel: () => void
}

let runtime: ReverseRuntime | null = null

export function setReverseRuntime(next: ReverseRuntime): void {
  runtime = next
}

export function reverseRuntime(): ReverseRuntime {
  if (!runtime) {
    throw new Error('本地识图尚未就绪，请先打开 NovelPrompt')
  }
  return runtime
}
