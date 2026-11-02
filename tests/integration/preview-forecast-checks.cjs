const assert = require('node:assert/strict')

/** Exercise the real preview orchestration with offline provider/evidence fixtures. */
module.exports = async function checkForecast(request) {
  const review = require('../../src/main/modules/prompts/preview-review.ts')
  const chat = require('../../src/main/modules/prompts/chat.ts')
  const skills = require('../../src/main/modules/skills/service.ts')
  const originals = {
    localReview: review.localReview,
    chat: chat.chat,
    composeSkills: skills.composeSkills,
  }
  let messages
  review.localReview = async () => ({
    sections: [],
    issues: [],
    tagCount: 1,
    ev: { block: '', info: { related: [], wiki: [], failed: [], implications: true } },
  })
  skills.composeSkills = () => ({ text: 'fixture skill', snapshot: [] })
  chat.chat = async (input) => {
    messages = input
    return {
      content: JSON.stringify({
        summary: '窗边的人物，阳光从侧面照入',
        gap: '与期望不同',
        suggestions: [{ text: '添加 sunlight', basis: 'rule' }],
      }),
    }
  }
  try {
    const { previewPrompt } = require('../../src/main/modules/prompts/previewer.ts')
    const forecast = await previewPrompt(
      { ...request, forecastOnly: true, expectation: 'private legacy expectation' },
      () => {},
    )
    assert.equal(forecast.gap, '')
    assert.deepEqual(forecast.suggestions, [])
    assert.ok(forecast.summary.includes('窗边'))
    assert.ok(messages[0].content.includes('本次仅推测当前提示词可能生成的画面'))
    assert.ok(!messages[1].content.includes('private legacy expectation'))
    const legacy = await previewPrompt(
      { ...request, forecastOnly: undefined, expectation: 'legacy expectation' },
      () => {},
    )
    assert.equal(legacy.gap, '与期望不同')
    assert.equal(legacy.suggestions.length, 1)
    assert.ok(messages[1].content.includes('legacy expectation'))
    console.log(
      'PASS forecast-only requests omit expectations and discard rewrite fields; legacy preview remains unchanged',
    )
  } finally {
    review.localReview = originals.localReview
    chat.chat = originals.chat
    skills.composeSkills = originals.composeSkills
  }
}
