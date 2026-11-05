import type { ConfirmationOptions } from '../../shared/contracts/confirmation'
import { setOperationAuthorizer } from '../infrastructure/operation-policy'
import { getSettings } from '../modules/settings/service'

/** Confirmation is owned by the main process and is not an Agent action. */
export function installOperationAuthorization(
  confirm: (options: ConfirmationOptions, signal?: AbortSignal) => Promise<boolean>,
): void {
  setOperationAuthorizer(async (operation, origin, signal) => {
    if (origin === 'agent' && getSettings().agentFreeOnly === false) {
      return true
    }
    const price =
      operation.estimatedCost === undefined
        ? '本次可能产生费用，金额暂无法估算。'
        : `预计消耗 ${operation.estimatedCost} ${operation.unit}。`
    return confirm(
      {
        title: origin === 'agent' ? 'Agent 请求付费授权' : '确认付费操作',
        message: operation.description,
        detail: price,
        confirmLabel: origin === 'agent' ? '允许本次' : '确认付费',
        cost: { amount: operation.estimatedCost, unit: operation.unit },
      },
      signal,
    )
  })
}
