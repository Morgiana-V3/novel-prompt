import { AsyncLocalStorage } from 'node:async_hooks'

/** Provider-neutral contract. Unknown prices are never treated as free. */
export interface PaidOperation {
  kind: string
  provider: string
  description: string
  quantity: number
  unit: string
  estimatedCost?: number
  /** Manual AI calls already disclose usage billing at their entry points. */
  confirmManual?: boolean
}
interface OperationContext {
  origin: 'manual' | 'agent'
  signal?: AbortSignal
}
const context = new AsyncLocalStorage<OperationContext>()
let authorize:
  | ((
      operation: PaidOperation,
      origin: OperationContext['origin'],
      signal?: AbortSignal,
    ) => Promise<boolean>)
  | undefined
export const setOperationAuthorizer = (handler: NonNullable<typeof authorize>) => {
  authorize = handler
}
export const withOperationContext = <T>(value: OperationContext, work: () => T): T =>
  context.run(
    { ...value, origin: context.getStore()?.origin === 'agent' ? 'agent' : value.origin },
    work,
  )
export const operationSignal = () => context.getStore()?.signal
export const operationOrigin = () => context.getStore()?.origin ?? 'manual'
export async function authorizePaidOperation(
  operation: PaidOperation,
  signal?: AbortSignal,
): Promise<void> {
  signal ??= context.getStore()?.signal
  if (signal?.aborted) {
    throw new Error('已取消')
  }
  const origin = operationOrigin()
  if (origin === 'manual' && operation.confirmManual === false) {
    return
  }
  // Snapshot the request; approval is consumed here, never exposed as an IPC token.
  const accepted = await authorize?.(structuredClone(operation), origin, signal)
  if (signal?.aborted) {
    throw new Error('已取消')
  }
  if (!accepted) {
    throw new Error(
      origin === 'agent' ? 'Agent 付费操作未获用户授权，未提交请求' : '已取消付费操作，未提交请求',
    )
  }
}
