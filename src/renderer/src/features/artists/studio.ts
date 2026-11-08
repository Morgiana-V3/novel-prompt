import { computed, reactive, ref, watch } from 'vue'
import { artistNameKey } from '@shared/artists/catalog'
import { parsePrompt } from '@shared/prompts/parser'
import { mixString } from '@shared/reverse/candidates'
import { removePromptTokens } from '@shared/prompts/remove-tokens'
import type { NaiGenRequest, NaiVersion } from '@shared/generation/types'
import type { NaiImage } from '@shared/images/types'
import { useReverseTrials } from '../reverse/use-reverse-trials'
import { imageState, DEFAULT_GEN } from '../generation/public'
import { promptState, DEFAULT_PARAMS } from '../prompts/public/draft'
import { applyWorkspace, revertTo } from '../prompts/public/editing'
import { importGenerationRequest } from '../prompts/public/import-export'
import { shellState } from '../../shared/state/shell'
import { settingsState } from '../settings/state'
import { creationTabs, switchTab, openTabForLoad } from '../creation/public/navigation'
import { toast, reportError } from '../../shared/lib/notifications'
import { blueprintKey, creationBlueprints, type ArtistBlueprint } from './blueprints'

export interface ArtistEntry {
  id: string
  name: string
  weight: number
  enabled: boolean
  locked: boolean
}

interface ArtistScheme {
  id: string
  name: string
  artists: ArtistEntry[]
}

interface BaselineImage {
  image: NaiImage
  key: string
  version: NaiVersion
  origin: 'blueprint' | 'generated'
}

const STORE_KEY = 'np-artist-studio-v1'
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value))

export function artistString(artists: ArtistEntry[]): string {
  return mixString(artists.filter((artist) => artist.enabled))
}

function initialState() {
  return {
    revision: 3,
    source: 'unset' as
      'unset' | 'creation' | 'gallery' | 'favorite' | 'reverse' | 'sample' | 'legacy',
    sourceId: '',
    sourceTitle: '',
    sourceKey: '',
    baseline: { id: 'baseline', name: '基准', artists: [] } as ArtistScheme,
    baselineImage: null as BaselineImage | null,
    draft: { id: 'draft', name: '当前画师串', artists: [] } as ArtistScheme,
    // Legacy schemes are retained only for recovering earlier work. New runs never append here.
    schemes: [] as ArtistScheme[],
    selectedId: '',
    favoriteArtists: [] as string[],
    weightRange: { min: 0, max: 2 },
    context: {
      base: '',
      negative: '',
      characters: [] as NaiGenRequest['characters'],
      version: 'v5' as NaiGenRequest['version'],
      params: { ...DEFAULT_PARAMS, ...DEFAULT_GEN, seed: 123456789, count: 1 },
    },
  }
}

type StudioState = ReturnType<typeof initialState>

function validScheme(value: ArtistScheme): boolean {
  return (
    typeof value?.id === 'string' &&
    typeof value.name === 'string' &&
    Array.isArray(value.artists) &&
    value.artists.length <= 100 &&
    value.artists.every(
      (artist) =>
        typeof artist.id === 'string' &&
        typeof artist.name === 'string' &&
        Number.isFinite(artist.weight) &&
        typeof artist.enabled === 'boolean' &&
        typeof artist.locked === 'boolean',
    )
  )
}

function loadState(version?: NaiVersion, fallback?: StudioState): StudioState {
  try {
    const versionDraft = version ? localStorage.getItem(`${STORE_KEY}-${version}`) : null
    const saved = JSON.parse(
      versionDraft ?? localStorage.getItem(STORE_KEY) ?? 'null',
    ) as StudioState
    const current = saved?.draft ?? saved?.schemes?.find((scheme) => scheme.id === saved.selectedId)
    if (
      (!version || saved?.context?.version === version) &&
      validScheme(saved?.baseline) &&
      Array.isArray(saved.schemes) &&
      saved.schemes.length <= 20 &&
      saved.schemes.every(validScheme) &&
      validScheme(current!) &&
      typeof saved.context?.base === 'string' &&
      typeof saved.context.negative === 'string' &&
      Array.isArray(saved.context.characters) &&
      ['v4.5', 'v5'].includes(saved.context.version) &&
      saved.context.params &&
      Number.isInteger(saved.context.params.seed)
    ) {
      saved.weightRange = {
        min: Number.isFinite(saved.weightRange?.min)
          ? Math.min(0, Math.floor(saved.weightRange.min))
          : 0,
        max:
          Number.isFinite(saved.weightRange?.max) && saved.weightRange.max > 0
            ? saved.weightRange.max
            : 2,
      }
      saved.draft = clone(current!)
      saved.sourceId ||= ''
      saved.sourceTitle ||= ''
      if (saved.revision !== 2 && saved.revision !== 3) {
        saved.context.base = withoutArtists(saved.context.base)
        saved.context.characters = saved.context.characters.map((character) => ({
          ...character,
          prompt: withoutArtists(character.prompt),
        }))
        saved.source = 'legacy'
        saved.sourceKey = ''
      }
      const reference = saved.baselineImage
      if (
        !reference ||
        typeof reference.key !== 'string' ||
        typeof reference.image?.url !== 'string' ||
        typeof reference.image.name !== 'string' ||
        !['v4.5', 'v5'].includes(reference.version) ||
        !['blueprint', 'generated'].includes(reference.origin)
      ) {
        saved.baselineImage = null
      }
      saved.revision = 3
      saved.favoriteArtists = Array.isArray(saved.favoriteArtists)
        ? saved.favoriteArtists.filter((name) => typeof name === 'string').slice(0, 100)
        : []
      return saved
    }
  } catch {
    // A missing or unreadable draft starts with the editable example.
  }
  const draft = fallback ? clone(fallback) : initialState()
  if (version) {
    draft.context.version = version
  }
  draft.baselineImage = null
  return draft
}

function withoutArtists(text: string): string {
  return removePromptTokens(
    text,
    parsePrompt(text).filter((token) => token.prefix === 'artist:'),
  )
}

export function useArtistStudio() {
  const state = reactive(loadState(settingsState.settings?.naiVersion ?? 'v5'))
  const { state: trials, run, stop } = useReverseTrials()
  const selected = computed(() => state.draft)
  const busy = computed(() => trials.running || imageState.generating)
  const results = reactive<Record<string, NaiImage>>({})
  const persistenceError = ref('')
  const sourceTab = computed(() =>
    creationBlueprints(state.context.version).find((tab) => tab.id === state.sourceId),
  )
  const sourceChanged = computed(
    () =>
      state.source === 'creation' &&
      (!sourceTab.value || state.sourceKey !== blueprintKey(sourceTab.value)),
  )
  const hasContent = computed(
    () =>
      !!state.context.base.trim() ||
      state.context.characters.some((character) => character.prompt.trim()),
  )
  function persist() {
    try {
      localStorage.setItem(`${STORE_KEY}-${state.context.version}`, JSON.stringify(state))
      persistenceError.value = ''
    } catch {
      persistenceError.value = '本地保存失败，请先复制画师串留存。'
    }
  }
  // One scale for every artist; changing the scale does not change generation requests.
  watch(
    () => selected.value.artists.map((artist) => artist.weight),
    (weights) => {
      state.weightRange.min = Math.min(state.weightRange.min, ...weights.map(Math.floor))
      const largest = Math.max(0, ...weights)
      if (largest > state.weightRange.max) {
        state.weightRange.max = Math.ceil(largest)
      }
    },
    { immediate: true },
  )
  watch(state, persist, { deep: true })

  // Images are keyed by their conditions; changing parameters keeps the selected artist string.
  watch(
    () => JSON.stringify(state.context),
    (_next, previous) => {
      if (previous && JSON.parse(previous).version === state.context.version) {
        trials.error = ''
      }
    },
    { flush: 'sync' },
  )

  watch(
    [() => settingsState.settings?.naiVersion, busy],
    ([version, running]) => {
      if (!version || running || version === state.context.version) {
        return
      }
      persist()
      Object.assign(state, loadState(version, state))
      trials.error = ''
    },
    { immediate: true },
  )

  const hasChanges = computed(
    () => artistString(state.baseline.artists) !== artistString(selected.value.artists),
  )
  const baselineReference = computed(() =>
    state.baselineImage?.key === JSON.stringify(request(state.baseline))
      ? state.baselineImage
      : null,
  )
  const pendingCount = computed(() => pendingRequests().length)
  const canChoose = computed(
    () => !busy.value && hasChanges.value && !!result(state.baseline) && !!result(selected.value),
  )

  function removeArtist(id: string) {
    if (!busy.value) {
      selected.value.artists = selected.value.artists.filter((artist) => artist.id !== id)
    }
  }

  function chooseWinner(winner: 'baseline' | 'candidate') {
    if (!canChoose.value) {
      return
    }
    if (winner === 'candidate') {
      const image = result(selected.value)!
      state.baseline = { ...clone(selected.value), id: 'baseline' }
      state.baselineImage = {
        image: clone(image),
        key: JSON.stringify(request(state.baseline)),
        version: state.context.version,
        origin: 'generated',
      }
      toast('已采用新图，继续调整画师即可开始下一轮')
    } else {
      selected.value.artists = clone(state.baseline.artists)
      selected.value.name = state.baseline.name
      toast('已保留原图并恢复对应的画师串')
    }
  }

  function pendingRequests() {
    const requests = [state.baseline, selected.value]
      .filter((scheme) => !result(scheme))
      .map(request)
    const unique = new Map(requests.map((entry) => [JSON.stringify(entry), entry]))
    return [...unique].filter(([key]) => !results[key]).map(([, entry]) => entry)
  }

  function request(scheme: ArtistScheme): NaiGenRequest {
    return {
      ...clone(state.context),
      params: { ...clone(state.context.params), count: 1 },
      base: [artistString(scheme.artists), state.context.base].filter(Boolean).join(', '),
    }
  }

  function addArtist(name: string) {
    if (busy.value) {
      return
    }
    const entries = parseArtists(`artist:${name}`)
    if (entries.length !== 1) {
      throw new Error('一次添加一位画师，整串请使用「粘贴画师串」')
    }
    if (
      selected.value.artists.some(
        (artist) => artistNameKey(artist.name) === artistNameKey(entries[0].name),
      )
    ) {
      toast('当前方案已包含这位画师')
      return
    }
    selected.value.artists.push(entries[0])
  }

  function toggleFavorite(name: string) {
    const index = state.favoriteArtists.findIndex(
      (entry) => artistNameKey(entry) === artistNameKey(name),
    )
    if (index < 0) {
      if (state.favoriteArtists.length >= 100) {
        toast('最多收藏 100 位画师')
        return
      }
      state.favoriteArtists.push(name)
      toast('已加入图鉴收藏')
    } else {
      state.favoriteArtists.splice(index, 1)
      toast('已移出图鉴收藏')
    }
  }

  function result(scheme: ArtistScheme) {
    const key = JSON.stringify(request(scheme))
    if (state.baselineImage?.key === key) {
      return state.baselineImage.image
    }
    return results[key]
  }

  function invalidateImage(scheme: ArtistScheme) {
    const key = JSON.stringify(request(scheme))
    delete results[key]
    if (state.baselineImage?.key === key) {
      state.baselineImage = null
    }
  }

  function restoreLegacyScheme(id: string) {
    const saved = state.schemes.find((scheme) => scheme.id === id)
    if (!busy.value && saved) {
      state.draft = { ...clone(saved), id: 'draft' }
      toast('已载入旧版画师串')
    }
  }

  function parseArtists(text: string): ArtistEntry[] {
    const tokens = parsePrompt(text)
    if (!tokens.length || tokens.some((token) => token.prefix !== 'artist:')) {
      throw new Error('请粘贴包含 artist: 前缀的画师串，画面内容请在生图创作中编辑')
    }
    return tokens.map((token) => ({
      id: crypto.randomUUID(),
      name: token.core,
      weight: Math.round(token.weight * 1000) / 1000,
      enabled: true,
      locked: false,
    }))
  }

  function useBlueprint(blueprint: ArtistBlueprint) {
    if (busy.value) {
      return
    }
    const input = clone(blueprint.request)
    selected.value.artists = [input.base, ...input.characters.map((character) => character.prompt)]
      .flatMap((text) => parsePrompt(text).filter((token) => token.prefix === 'artist:'))
      .map((token) => ({
        id: crypto.randomUUID(),
        name: token.core,
        weight: token.weight,
        enabled: true,
        locked: false,
      }))
    state.context = {
      base: withoutArtists(input.base),
      negative: input.negative,
      characters: input.characters.map((character) => ({
        ...character,
        prompt: withoutArtists(character.prompt),
      })),
      version: state.context.version,
      params: {
        ...DEFAULT_PARAMS,
        ...DEFAULT_GEN,
        ...input.params,
        seed: input.params.seed ?? blueprint.image?.seed ?? 123456789,
        count: 1,
      },
    }
    state.source = blueprint.kind
    state.sourceId = blueprint.id
    state.sourceTitle = blueprint.title
    state.sourceKey = blueprintKey(blueprint)
    state.baseline = {
      id: 'baseline',
      name: blueprint.title,
      artists: clone(selected.value.artists),
    }
    state.baselineImage = blueprint.image
      ? {
          image: clone(blueprint.image),
          key: JSON.stringify(request(state.baseline)),
          version: input.version,
          origin: 'blueprint',
        }
      : null
  }

  function refreshSource() {
    if (sourceTab.value) {
      useBlueprint(sourceTab.value)
    }
  }

  function editSource() {
    if (busy.value || !sourceTab.value) {
      return
    }
    switchTab(state.sourceId)
    if (creationTabs.activeId === state.sourceId) {
      shellState.tab = 'creation'
    }
  }

  async function applyToCreation() {
    if (busy.value || hasChanges.value || sourceChanged.value || !result(state.baseline)) {
      return
    }
    if (state.source !== 'creation') {
      if (openTabForLoad('画师调试')) {
        try {
          await importGenerationRequest(request(state.baseline), '画师调试', { keepSeed: true })
          shellState.tab = 'creation'
        } catch (error) {
          reportError(error)
        }
      }
      return
    }
    switchTab(state.sourceId)
    if (creationTabs.activeId !== state.sourceId) {
      return
    }
    const before = applyWorkspace(
      {
        base: [artistString(state.baseline.artists), withoutArtists(promptState.prompt)]
          .filter(Boolean)
          .join(', '),
        negative: promptState.negative,
        characters: clone(promptState.characters).map((character) => ({
          ...character,
          prompt: withoutArtists(character.prompt),
        })),
      },
      '应用画师串前',
    )
    state.sourceKey = blueprintKey(sourceTab.value!)
    const targetId = state.sourceId
    shellState.tab = 'creation'
    toast('已应用到「' + sourceTab.value!.title + '」', {
      label: '撤销',
      run: () => {
        if (!creationTabs.list.some((tab) => tab.id === targetId)) {
          toast('来源标签已关闭，请从历史中找回')
          return
        }
        switchTab(targetId)
        if (creationTabs.activeId === targetId) {
          revertTo(before, '撤销画师串前')
        }
      },
    })
  }

  async function generate() {
    if (busy.value || !hasContent.value) {
      return
    }
    const seed = state.context.params.seed
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
      trials.error = '请填写 0 到 4294967295 的整数种子'
      return
    }
    const candidates = pendingRequests().map((entry) => ({ style: entry.base, request: entry }))
    if (!candidates.length) {
      return
    }
    await run(candidates)
    trials.trials.forEach((trial) => {
      if (trial.image) {
        results[JSON.stringify(trial.request)] = trial.image
      }
    })
  }

  return {
    state,
    selected,
    busy,
    trials,
    persistenceError,
    sourceChanged,
    sourceTab,
    useBlueprint,
    refreshSource,
    editSource,
    hasContent,
    applyToCreation,
    addArtist,
    removeArtist,
    chooseWinner,
    canChoose,
    hasChanges,
    pendingCount,
    toggleFavorite,
    result,
    baselineReference,
    invalidateImage,
    restoreLegacyScheme,
    parseArtists,
    generate,
    stop,
  }
}
