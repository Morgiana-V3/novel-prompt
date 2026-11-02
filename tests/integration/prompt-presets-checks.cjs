const assert = require('node:assert/strict')
module.exports = async function checkPromptPresets() {
  const chat = require('../../src/main/modules/prompts/chat.ts')
  const skills = require('../../src/main/modules/skills/service.ts')
  const evidence = require('../../src/main/modules/prompts/evidence.ts')
  const analyzer = require('../../src/main/modules/prompts/analyzer.ts')
  const original = {
    chat: chat.chat,
    compose: skills.composeSkills,
    gather: evidence.gatherEvidence,
    analyze: analyzer.analyzePrompt,
  }
  const { buildBody } = require('../../src/main/providers/novelai/payload.ts')
  const { withQualityTags } = require('../../src/shared/generation/presets.ts')
  assert.equal(withQualityTags('Text: Hello', 'v5', 'none'), 'Text: Hello')
  let messages
  chat.chat = async (input) => {
    messages = input
    return {
      role: 'assistant',
      content: JSON.stringify({
        positive: 'comic, Text: Hello',
        negative: 'blurry',
        characters: [],
        changes: [],
      }),
    }
  }
  skills.composeSkills = () => ({ text: 'fixture', snapshot: [] })
  evidence.gatherEvidence = async () => ({
    issues: [],
    block: '',
    info: { related: [], wiki: [], failed: [], implications: true },
  })
  analyzer.analyzePrompt = () => ({ tokens: [], stats: {} })
  try {
    const { optimizePrompt } = require('../../src/main/modules/prompts/optimizer.ts')
    const req = {
      mode: 'optimize',
      prompt: 'comic, Text: Hello',
      negative: 'blurry',
      characters: [],
      instruction: '',
    }
    for (const version of ['v4.5', 'v5']) {
      for (const mode of ['standard', 'light', 'none']) {
        const qualityTags = mode !== 'none'
        const qualityMode = mode === 'light' ? 'light' : 'standard'
        for (const ucPreset of ['heavy', 'light', 'human', 'none']) {
          const promptPresets = { qualityTags, qualityMode, ucPreset }
          const output = await optimizePrompt({ ...req, version, promptPresets }, () => {})
          const actual = buildBody(
            {
              base: req.prompt,
              negative: req.negative,
              characters: [],
              version,
              params: promptPresets,
            },
            42,
          )
          assert.ok(messages[1].content.includes(`当前实际主提示词：${actual.input}`))
          if (version === 'v5' && mode === 'light') {
            assert.equal(
              actual.input,
              'comic, very aesthetic, amazing quality, no text, Text: Hello',
            )
          }
          if (version === 'v4.5' && mode === 'light') {
            assert.ok(actual.input.includes('location, very aesthetic, masterpiece, no text'))
          }
          if (mode === 'none') {
            assert.equal(actual.input, req.prompt)
          }
          assert.ok(
            messages[1].content.includes(
              `当前实际负面提示词：${actual.parameters.negative_prompt}`,
            ),
          )
          assert.ok(messages[1].content.includes('scope=optional'))
          assert.equal(
            output.positive,
            req.prompt,
            'preset context does not mutate editable output',
          )
        }
      }
    }
    await optimizePrompt({ ...req, version: 'v5' }, () => {})
    assert.ok(messages[1].content.includes('调用方未提供'))
    chat.chat = async () => ({
      role: 'assistant',
      content: JSON.stringify({
        positive: req.prompt,
        negative: req.negative,
        characters: [{ prompt: '' }, { prompt: 'cat' }],
        changes: [
          {
            scope: 'character',
            text: 'Cat prompt',
            characterIndex: 1,
            characterSide: 'after',
            characterField: 'prompt',
          },
          {
            scope: 'character',
            text: 'Removed role',
            characterIndex: 1,
            characterSide: 'before',
            characterField: 'negative',
          },
          {
            scope: 'character',
            text: 'Empty output role',
            characterIndex: 0,
            characterSide: 'after',
          },
        ],
      }),
    })
    const normalized = await optimizePrompt({ ...req, version: 'v5' }, () => {})
    assert.equal(normalized.characters.length, 1)
    assert.deepEqual(
      normalized.changes.map((c) => [c.characterIndex, c.characterSide, c.characterField]),
      [
        [0, 'after', 'prompt'],
        [1, 'before', 'negative'],
        [-1, 'after', 'prompt'],
      ],
    )
    console.log(
      'PASS optimizer receives exact generation preset context for both models, all UC modes and quality on/off; omitted settings stay unknown',
    )
  } finally {
    chat.chat = original.chat
    skills.composeSkills = original.compose
    evidence.gatherEvidence = original.gather
    analyzer.analyzePrompt = original.analyze
  }
}
