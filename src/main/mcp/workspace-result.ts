import type { readPage } from '../page-workspaces'

/** Masks can be megabytes; summaries keep context bounded while retaining stable region IDs. */
export function workspaceResult(w: ReturnType<typeof readPage>) {
  return { ...w, messages: w.messages.map(m => ({ ...m, externalRequest: m.externalRequest ? { status: m.externalRequest.status } : undefined, skillSnapshot: m.skillSnapshot ? { digest: m.skillSnapshot.digest } : undefined, proposal: m.proposal ? { ...m.proposal, contextKey: undefined, appliedContextKey: undefined } : undefined })),
    versions: w.versions.map(v => ({ ...v, generated: v.generated ? { ...v.generated, inpaint: v.generated.inpaint ? { ...v.generated.inpaint, mask: undefined } : undefined } : undefined,
    editor: { ...v.editor, regions: v.editor.regions.map(r => ({ ...r, mask: undefined, hasMask: !!r.mask })) } })) }
}
