import type { FrontendContext, FrontendRequest } from '@shared/contracts/desktop'
import { patchWorkspaceConfig } from '@shared/workspace/config'
import type {
  PageAgentIdentity,
  PageEditorState,
  PageExecution,
  PageMessage,
  PageWorkspace,
} from '@shared/workspace/model'
import { pageComparison, pageLatestProposal } from '@shared/workspace/model'
import type { Ref } from 'vue'
import { nextTick } from 'vue'

interface WorkspaceCommandHost {
  configOwner: Ref<string | null>
  operation: Ref<string>
  remoteBusy: Ref<boolean>
  editing: Ref<boolean>
  renaming: Ref<boolean>
  editingPrompt: Ref<boolean>
  connections: Ref<PageAgentIdentity[]>
  error: Ref<string>
  work: Ref<PageWorkspace>
  current: Ref<PageWorkspace['versions'][number]>
  nameDraft: Ref<string>
  viewedId: Ref<string>
  pane: Ref<'canvas' | 'prompt' | 'changes' | 'images'>
  clearingImage: Ref<string | null>
  configDraft: Ref<PageEditorState | null>
  configSizeLocked: Ref<boolean>
  external: Ref<boolean>
  savedNotes: Ref<string>
  viewed: Ref<PageWorkspace['versions'][number]>
  historyOpen: Ref<boolean>
  compareVersionId: Ref<string>
  composer: Ref<string>
  regionId: Ref<string | null>
  references: Ref<string[]>
  overlayMode: Ref<'annotation' | 'execution'>
  pendingRequest: Ref<PageMessage | undefined>
  inpaintEditor: Ref<
    | { frontendRegion: (request: FrontendRequest, context: FrontendContext) => Promise<string> }
    | undefined
  >
  flushNotes: () => Promise<void>
  startRename: () => Promise<void>
  rename: () => Promise<void>
  clearImage: (versionId: string) => Promise<void>
  beginConfig: (owner?: string | null) => Promise<void>
  finishConfig: (discard?: boolean) => Promise<void>
  setAgentMode: (mode: 'internal' | 'external') => Promise<void>
  cancelExternal: () => Promise<void>
  notesValue: () => unknown
  emit: (event: 'updated') => void
  scrollEnd: () => Promise<void>
  showSuggestions: (versionId: string, messageId?: string) => Promise<void>
  review: (versionId: string) => void
  refreshOverlay: () => Promise<void>
  send: () => Promise<void>
  openEditor: () => Promise<void>
  closeEditor: () => Promise<void>
  continueVersion: (versionId: string) => Promise<void>
  setExecution: (execution: PageExecution) => Promise<void>
  inspectMask: () => void
  generate: () => Promise<void>
  proposal: (message: PageMessage, decision: 'accept' | 'reject' | 'undo') => Promise<void>
  frontendContext: FrontendContext | undefined
}

export function createWorkspaceCommands(host: WorkspaceCommandHost) {
  const {
    configOwner,
    operation,
    remoteBusy,
    editing,
    renaming,
    editingPrompt,
    connections,
    error,
    work,
    current,
    nameDraft,
    viewedId,
    pane,
    clearingImage,
    configDraft,
    configSizeLocked,
    external,
    savedNotes,
    viewed,
    historyOpen,
    compareVersionId,
    composer,
    regionId,
    references,
    overlayMode,
    pendingRequest,
    inpaintEditor,
    flushNotes,
    startRename,
    rename,
    clearImage,
    beginConfig,
    finishConfig,
    setAgentMode,
    cancelExternal,
    notesValue,
    emit,
    scrollEnd,
    showSuggestions,
    review,
    refreshOverlay,
    send,
    openEditor,
    closeEditor,
    continueVersion,
    setExecution,
    inspectMask,
    generate,
    proposal,
  } = host
  async function frontendAction(request: FrontendRequest, ctx: FrontendContext) {
    const resumeOwner = configOwner.value
    if (
      operation.value ||
      remoteBusy.value ||
      editing.value ||
      renaming.value ||
      host.frontendContext ||
      (editingPrompt.value && request.action !== 'config')
    ) {
      throw new Error('工作台正在编辑或执行任务，请先完成当前操作')
    }
    if (
      request.action === 'config' &&
      editingPrompt.value &&
      (!ctx.agentSession || configOwner.value !== ctx.agentSession)
    ) {
      // Only an explicit resume may claim an abandoned agent draft. Human edits
      // clear its owner and remain protected, even after the old agent disconnects.
      const live =
        request.config_action === 'resume' ? await window.api.agentConnections() : connections.value
      if (
        request.config_action !== 'resume' ||
        !ctx.agentSession ||
        !configOwner.value ||
        live.some((agent) => agent.sessionId === configOwner.value)
      ) {
        throw new Error('正在编辑的配置属于用户或其他 Agent，未覆盖修改')
      }
      connections.value = live
    }
    host.frontendContext = ctx
    error.value = ''
    const check = () => {
      if (error.value) {
        throw new Error(error.value)
      }
      if (ctx.signal.aborted) {
        throw new Error('已停止，已保存的内容保留')
      }
    }
    const version = (id?: string) => {
      const version2 = work.value.versions.find(
        (version3) => version3.id === (id ?? current.value.id),
      )
      if (!version2) {
        throw new Error('版本不存在')
      }
      return version2
    }
    try {
      await flushNotes()
      check()
      if (request.action === 'rename') {
        await startRename()
        nameDraft.value = request.title!
        await ctx.step('已在项目标题处填写新名称')
        await rename()
        check()
        await ctx.step('项目名称已保存')
      } else if (request.action === 'delete-image') {
        if (request.confirm !== true) {
          throw new Error('缺少删除授权')
        }
        const version2 = version(request.version_id)
        if (!version2.image) {
          throw new Error('此版本没有可删除的图片')
        }
        viewedId.value = version2.id
        pane.value = 'images'
        await nextTick()
        clearingImage.value = version2.id
        await ctx.step('已定位指定候选并展示删除提示')
        await clearImage(version2.id)
        check()
        await ctx.step('图片已清理，提示词和讨论记录保留')
      } else if (request.action === 'config') {
        if (request.config_action === 'begin') {
          if (editingPrompt.value) {
            throw new Error('配置编辑已打开')
          }
          await beginConfig(ctx.agentSession!)
          await ctx.step('已打开下一版配置，可手动或通过 MCP 微调')
        } else {
          if (!editingPrompt.value || !configDraft.value) {
            throw new Error('请先开始配置编辑')
          }
          if (request.config_action === 'resume') {
            if (!resumeOwner || configOwner.value !== resumeOwner) {
              throw new Error('编辑归属已改变，请重新读取配置，未覆盖修改')
            }
            configOwner.value = ctx.agentSession!
            await ctx.step('已接续断线 Agent 的配置草稿，内容保持原样，尚未保存')
          } else if (request.config_action === 'update') {
            configDraft.value = patchWorkspaceConfig(
              configDraft.value,
              request.patch!,
              configSizeLocked.value,
            )
            await ctx.step('表单已更新，尚未保存或生成')
          } else if (request.config_action === 'save') {
            await finishConfig()
            await ctx.step('下一版配置已保存，已返回查看')
          } else if (request.config_action === 'cancel') {
            await finishConfig(true)
            await ctx.step('已放弃本次未保存修改，返回查看')
          }
        }
      } else if (request.action === 'agent') {
        await ctx.step('正在切换会话处理方式')
        await setAgentMode(request.mode!)
        check()
        await ctx.step(external.value ? '已由外部 Agent 接管，不调用内置 AI' : '已切换为内置 AI')
      } else if (request.action === 'external-cancel') {
        await cancelExternal()
        check()
        await ctx.step('已取消本轮外部需求，原消息和结果保留')
      } else if (request.action === 'reply') {
        await ctx.step('正在接收外部 Agent 的回复与方案')
        work.value = await window.api.pagesExternalReply(
          work.value.id,
          work.value.revision,
          JSON.parse(JSON.stringify(request.response)),
          ctx.actionId,
        )
        savedNotes.value = JSON.stringify(notesValue())
        emit('updated')
        await scrollEnd()
        const message = work.value.messages.at(-1)
        if (message?.proposal) {
          await showSuggestions(message.versionId, message.id)
        }
        await ctx.step('外部 Agent 回复已显示，方案尚未采纳')
      } else if (request.action === 'view') {
        const version2 = version(request.version_id ?? viewed.value.id)
        if (request.compare_version_id !== undefined) {
          if (request.pane !== 'changes') {
            throw new Error('对比对象仅用于修改对比面板')
          }
          pageComparison(work.value, version2.id, request.compare_version_id)
        }
        viewedId.value = version2.id
        if (request.pane === 'history') {
          historyOpen.value = true
          pane.value = 'canvas'
        } else if (request.pane !== 'suggestions') {
          pane.value = request.pane!
        }
        if (request.pane === 'changes') {
          review(version2.id)
        }
        if (request.pane === 'suggestions') {
          await showSuggestions(version2.id)
        }
        if (request.compare_version_id !== undefined) {
          compareVersionId.value = request.compare_version_id
        }
        await ctx.step('已切换工作台视图')
      } else if (request.action === 'compose') {
        if (
          request.region_id &&
          !current.value.editor.regions.some((region) => region.id === request.region_id)
        ) {
          throw new Error('区域不存在')
        }
        for (const id of request.reference_ids ?? []) {
          version(id)
        }
        composer.value = request.text!
        regionId.value = request.region_id ?? null
        references.value = [...new Set(request.reference_ids ?? [])]
        if (regionId.value) {
          viewedId.value = current.value.id
          pane.value = 'canvas'
          overlayMode.value = 'annotation'
          await refreshOverlay()
        }
        await flushNotes()
        await ctx.step('需求已填入对话框，尚未提交')
      } else if (request.action === 'send') {
        if (!composer.value.trim()) {
          throw new Error('对话框为空，请先填写内容')
        }
        if (external.value && pendingRequest.value) {
          throw new Error('已有待处理需求，请等待回复或取消后再发送')
        }
        await ctx.step('正在提交当前对话框内容')
        await send()
        check()
        if (pageLatestProposal(work.value, current.value.id)?.proposal?.status === 'pending') {
          await showSuggestions(current.value.id)
        }
        await ctx.step(
          external.value
            ? '需求已保存，等待外部 Agent 读取并回复'
            : 'AI 回复已显示，可查看建议后决定是否采纳',
        )
      } else if (['region', 'region-update', 'region-delete'].includes(request.action)) {
        if (request.action !== 'region') {
          if (request.version_id !== current.value.id) {
            throw new Error('区域只能修改已采用候选，请重新读取状态')
          }
          if (!current.value.editor.regions.some((region) => region.id === request.region_id)) {
            throw new Error('区域不存在')
          }
        }
        if (!current.value.image || current.value.image.missing) {
          throw new Error('当前版本没有可读取的图片，无法打开选区编辑器')
        }
        pane.value = 'canvas'
        let id: string
        try {
          await openEditor()
          check()
          await nextTick()
          if (!inpaintEditor.value) {
            throw new Error('选区编辑器未打开')
          }
          id = await inpaintEditor.value.frontendRegion(request, ctx)
        } finally {
          if (editing.value) {
            await closeEditor()
          }
        }
        regionId.value = request.action === 'region-delete' ? null : id
        await refreshOverlay()
        await ctx.step(
          request.action === 'region-delete'
            ? '指定区域已从工作台删除'
            : '区域与批注已保存到工作台',
        )
      } else if (request.action === 'review') {
        if (request.decision === 'switch') {
          const version2 = version(request.version_id)
          historyOpen.value = true
          viewedId.value = version2.id
          pane.value = 'canvas'
          await ctx.step('已显示要继续的历史版本')
          await continueVersion(version2.id)
        } else {
          const message = work.value.messages.find(
            (message2) => message2.id === request.message_id && message2.proposal,
          )
          if (!message) {
            throw new Error('建议不存在')
          }
          await showSuggestions(message.versionId, message.id)
          await ctx.step('已在对话中展开待处理方案')
          await proposal(message, request.decision as 'accept' | 'reject' | 'undo')
        }
        check()
        await ctx.step('处理结果已显示')
      } else if (request.action === 'generate') {
        if (
          request.kind === 'inpaint' &&
          !current.value.editor.regions.some((region) => region.id === request.region_id)
        ) {
          throw new Error('重绘区域不存在')
        }
        await setExecution({
          kind: request.kind!,
          regionId: request.kind === 'inpaint' ? request.region_id! : null,
        })
        check()
        inspectMask()
        await refreshOverlay()
        await ctx.step(
          request.kind === 'inpaint' ? '已显示重绘遮罩，即将执行' : '已选择整图生成，即将执行',
        )
        await generate()
        check()
        historyOpen.value = true
        await ctx.step('结果已显示在画布与历史记录中')
      } else {
        throw new Error('不支持的前台工作台操作')
      }
    } finally {
      host.frontendContext = undefined
    }
  }
  return frontendAction
}
