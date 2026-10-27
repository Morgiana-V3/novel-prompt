export interface UpdateInfo {
  /** 更新状态由主进程维护，revision 防止较晚返回的 IPC 覆盖下载进度 */
  revision?: number
  stage?: 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'installing' | 'error'
  autoSupported?: boolean
  manualReason?: string
  percent?: number
  /** 当前安装的版本 */
  current: string
  /** 最新版本号（检查失败时为空） */
  latest: string
  /** latest 是否比 current 新 */
  newer: boolean
  /** release 页面地址 */
  url: string
  /** release 正文（截断后） */
  notes?: string
  /** 上次成功检查的时间戳，0 = 从未检查成功过 */
  checkedAt: number
  /** 检查、下载或安装失败的原因 */
  error?: string
}
