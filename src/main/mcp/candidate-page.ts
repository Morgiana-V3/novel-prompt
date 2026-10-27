export const CANDIDATE_PAGE_SCHEMA = {
  version_limit: { type: 'integer', minimum: 1, maximum: 100, description: '每页候选数，默认 10，最多 100。' },
  before_version_id: { type: 'string', description: '上一页 versionsPage/candidatesPage.nextBeforeVersionId；向前读取较早候选。' },
  history_revision: { type: 'integer', description: '翻页必须提供上一页的 revision；变化时拒绝混合分页。' }
}
export function candidatePage<T extends { id: string }>(items: T[], args: Record<string, unknown>, revision: number, total: number, included = true, targeted = false) {
  if (args.before_version_id !== undefined && args.history_revision === undefined) throw Error('候选翻页须携带上一页 revision 作为 history_revision')
  if (args.history_revision !== undefined && args.history_revision !== revision) throw Error('候选已更新，请从第一页重新读取')
  if (targeted && args.before_version_id !== undefined) throw Error('version_ids 不能与候选分页游标同时使用')
  const limit = targeted ? items.length : Number(args.version_limit ?? 10)
  const end = args.before_version_id === undefined ? items.length : items.findIndex(v => v.id === args.before_version_id)
  if (end < 0) throw Error('候选游标不存在，请重新读取会话')
  const start = targeted ? 0 : Math.max(0, end - limit)
  return { items: included ? items.slice(start, end) : [], page: { total, matching: items.length, limit, revision, included,
    hasMore: included && start > 0, nextBeforeVersionId: included && start > 0 ? items[start].id : null } }
}
