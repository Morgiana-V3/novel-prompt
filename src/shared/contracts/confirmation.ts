export interface ConfirmationOptions {
  title: string
  message: string
  detail?: string
  confirmLabel: string
  /** 付费确认的预计费用；amount 缺省表示暂无法估算。提供时界面使用紧凑的付费确认样式 */
  cost?: { amount?: number; unit: string }
}
export interface ConfirmationRequest extends ConfirmationOptions {
  id: string
}
