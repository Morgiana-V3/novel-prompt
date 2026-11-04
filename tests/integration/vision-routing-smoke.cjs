// 识图：模型能力表、不支持传图时的报错翻译、识图模型分流与纯文字降级、设置页的测试识图。
const assert = require('node:assert/strict')
const { app, net } = require('electron')
const { temporaryProfile } = require('../support/fixtures.cjs')
const profile = temporaryProfile('np-vision-routing-')
app.setPath('userData', profile)
require('../support/register-typescript.cjs')
const { requestChat, VisionUnsupportedError } = require('../../src/main/providers/chat/client.ts')
const { chat, visionRoute } = require('../../src/main/modules/prompts/chat.ts')
const { testVision } = require('../../src/main/modules/prompts/vision-test.ts')
const { saveSettings } = require('../../src/main/modules/settings/service.ts')
const { AI_PRESETS } = require('../../src/shared/settings/ai-presets.ts')
const { modelVision, VISION_SUGGESTIONS } = require('../../src/shared/settings/vision.ts')

const image = { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }
const withImage = () => [
  { role: 'system', content: 'fixture' },
  { role: 'user', content: [{ type: 'text', text: '看图' }, image] },
]
const imagesIn = (body) =>
  body.messages.flatMap((message) =>
    Array.isArray(message.content)
      ? message.content.filter((part) => part.type === 'image_url')
      : [],
  ).length
const ok = (content = '{"reply":"ok"}') =>
  new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }))
const unsupported = () =>
  new Response(
    JSON.stringify({
      error: { message: 'Failed to deserialize: unknown variant `image_url`, expected `text`' },
    }),
    { status: 400 },
  )

let sent = []
let respond = () => ok()
net.fetch = async (url, options) => {
  const body = JSON.parse(options.body)
  sent.push({ url, auth: options.headers.Authorization, body })
  return respond(body, sent.length)
}
const reset = (handler = () => ok()) => {
  sent = []
  respond = handler
}
const base = {
  apiKey: 'main-key',
  baseUrl: 'https://api.deepseek.com',
  reasoningEffort: 'off',
  visionModel: '',
  visionBaseUrl: '',
  visionApiKey: '',
}

app.whenReady().then(async () => {
  try {
    // 能力表：每个预设的推荐识图模型都判定为支持；已知纯文本模型判定为不支持
    for (const preset of AI_PRESETS.filter((item) => item.id !== 'custom')) {
      assert.equal(modelVision(VISION_SUGGESTIONS[preset.id]), 'yes', preset.id)
      assert.equal(modelVision(preset.model), preset.id === 'glm' ? 'no' : 'yes', preset.model)
    }
    for (const model of ['deepseek-v4-pro', 'glm-5.3', 'glm-5.2', 'glm-5-turbo', 'qwen3-max']) {
      assert.equal(modelVision(model), 'no', model)
    }
    for (const model of ['glm-5v-turbo', 'openai/gpt-6-luna', 'qwen3-vl-plus', 'kimi-k3']) {
      assert.equal(modelVision(model), 'yes', model)
    }
    assert.equal(modelVision('qwen-plus'), 'unknown')
    assert.equal(modelVision('my-gateway-model'), 'unknown')
    console.log('PASS vision capability table covers every preset and known text-only models')

    // 报错翻译：带图被拒 → 不支持识图；图片过大不误判；不带图的 400 不翻译
    const settings = { ...base, model: 'my-gateway-model' }
    reset(() => unsupported())
    await assert.rejects(requestChat(withImage(), settings), (error) => {
      assert(error instanceof VisionUnsupportedError)
      assert.match(error.message, /不支持图片输入.*识图模型/)
      return true
    })
    reset(
      () =>
        new Response(JSON.stringify({ error: { message: 'image too large' } }), { status: 400 }),
    )
    await assert.rejects(
      requestChat(withImage(), settings),
      (error) => !(error instanceof VisionUnsupportedError) && /HTTP 400/.test(error.message),
    )
    reset(() => unsupported())
    await assert.rejects(
      requestChat([{ role: 'user', content: 'text only' }], settings),
      (error) => !(error instanceof VisionUnsupportedError),
    )
    console.log('PASS image rejections become a readable "model cannot see images" error')

    // 已知纯文本主模型、未配置识图模型：直接去图，不浪费一次失败请求
    saveSettings({ ...base, model: 'deepseek-v4-pro' })
    reset()
    let messages = withImage()
    await chat(messages)
    assert.equal(sent.length, 1)
    assert.equal(imagesIn(sent[0].body), 0)
    assert.match(JSON.stringify(sent[0].body.messages), /图片未发送/)
    assert.equal(visionRoute(messages), 'text')
    // 后续轮次沿用同一条路，不再带图
    messages.push({ role: 'assistant', content: 'ok' }, { role: 'user', content: '继续' })
    await chat(messages)
    assert.equal(imagesIn(sent[1].body), 0)
    console.log('PASS text-only main model drops images up front and says so to the model')

    // 纯文本主模型 + 识图模型（只填 ID）：带图请求走识图模型，沿用主接口地址和 Key
    saveSettings({ ...base, model: 'deepseek-v4-pro', visionModel: 'deepseek-flash' })
    reset()
    messages = withImage()
    await chat(messages)
    assert.equal(sent[0].body.model, 'deepseek-flash')
    assert.equal(sent[0].auth, 'Bearer main-key')
    assert.equal(imagesIn(sent[0].body), 1)
    assert.equal(visionRoute(messages), 'vision')
    // 不带图的请求仍用主模型
    reset()
    await chat([{ role: 'user', content: 'text only' }])
    assert.equal(sent[0].body.model, 'deepseek-v4-pro')
    console.log('PASS images go to the vision model while text requests keep the main model')

    // 支持识图的主模型优先，不绕道识图模型
    saveSettings({ ...base, model: 'deepseek-flash', visionModel: 'glm-5v-turbo' })
    reset()
    await chat(withImage())
    assert.equal(sent[0].body.model, 'deepseek-flash')
    console.log('PASS a vision-capable main model is used directly')

    // 未知模型被拒 → 改走单独配置的识图接口（自己的地址与 Key）
    saveSettings({
      ...base,
      model: 'my-gateway-model',
      visionModel: 'glm-5v-turbo',
      visionBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      visionApiKey: 'vision-key',
    })
    reset()
    messages = withImage()
    await chat(messages)
    // 未知能力且配置了识图模型时直接走识图模型
    assert.equal(sent.length, 1)
    assert.equal(sent[0].url, 'https://open.bigmodel.cn/api/paas/v4/chat/completions')
    assert.equal(sent[0].auth, 'Bearer vision-key')
    assert.equal(visionRoute(messages), 'vision')
    console.log('PASS unknown main models route images to a separately configured vision endpoint')

    // 未知模型、无识图模型：先试主模型，被拒后去图重发
    saveSettings({ ...base, model: 'my-gateway-model' })
    reset((_body, count) => (count === 1 ? unsupported() : ok()))
    messages = withImage()
    await chat(messages)
    assert.equal(sent.length, 2)
    assert.equal(imagesIn(sent[0].body), 1)
    assert.equal(imagesIn(sent[1].body), 0)
    assert.equal(visionRoute(messages), 'text')
    console.log('PASS unknown models fall back to text-only after the provider rejects images')

    // 识图模型本身也不收图：给出指向识图模型的报错
    saveSettings({ ...base, model: 'deepseek-v4-pro', visionModel: 'glm-5.3' })
    reset(() => unsupported())
    await assert.rejects(chat(withImage()), /识图模型 glm-5\.3 不支持图片输入/)
    console.log('PASS a broken vision model reports which setting to fix')

    // 设置页「测试识图」
    const provider = { apiKey: 'k', baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash' }
    reset(() => ok('红色'))
    let result = await testVision(provider)
    assert.equal(result.ok, true)
    assert.equal(imagesIn(sent[0].body), 1)
    reset(() => ok('蓝色'))
    result = await testVision(provider)
    assert.equal(result.ok, false)
    assert.match(result.message, /没认出图片/)
    reset(() => unsupported())
    result = await testVision({ ...provider, model: 'deepseek-v4-pro' })
    assert.deepEqual(result, { ok: false, message: 'deepseek-v4-pro 不支持图片输入' })
    console.log('PASS vision test detects working, image-dropping and text-only endpoints')

    console.log('All vision routing checks passed.')
    app.exit(0)
  } catch (error) {
    console.error(error)
    app.exit(1)
  }
})
