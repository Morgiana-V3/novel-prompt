export interface ConfirmationOptions {
  title: string
  message: string
  detail?: string
  confirmLabel: string
}
export interface ConfirmationRequest extends ConfirmationOptions {
  id: string
}
