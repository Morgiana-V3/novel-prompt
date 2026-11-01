const assert = require('node:assert/strict')
const { app, net } = require('electron')
require('../support/register-typescript.cjs')
const { requestChat } = require('../../src/main/providers/chat/client.ts')
const { AI_PRESETS, inferAiPreset } = require('../../src/shared/settings/ai-presets.ts')

app.whenReady().then(async () => {
  try {
    let sent
    net.fetch = async (url, options) => {
      sent = { url, headers: options.headers, body: JSON.parse(options.body) }
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                role: 'assistant',
                content: null,
                reasoning_content: 'fixture reasoning',
                tool_calls: [
                  { id: 'call-1', type: 'function', function: { name: 'lookup', arguments: '{}' } },
                ],
              },
            },
          ],
        }),
      )
    }
    const tools = [
      {
        type: 'function',
        function: {
          name: 'lookup',
          description: 'Lookup',
          parameters: { type: 'object', properties: {} },
        },
      },
    ]
    for (const preset of AI_PRESETS.filter((item) => item.id !== 'custom')) {
      assert.equal(inferAiPreset(preset.baseUrl + '/'), preset.id)
      for (const model of preset.models) {
        const settings = {
          apiKey: 'fixture-key',
          baseUrl: preset.baseUrl,
          model,
          reasoningEffort: 'low',
        }
        const reply = await requestChat([{ role: 'user', content: 'Look up a tag' }], settings, {
          tools,
          json: true,
          temperature: 0.2,
        })
        assert.equal(sent.url, preset.baseUrl + '/chat/completions')
        assert.equal(sent.headers.Authorization, 'Bearer fixture-key')
        assert.equal(sent.body.model, model)
        assert.deepEqual(sent.body.tools, tools)
        assert.deepEqual(sent.body.response_format, { type: 'json_object' })
        if (preset.id === 'openai' || preset.id === 'kimi') {
          assert(!('temperature' in sent.body), `${model} uses supported sampling defaults`)
        }
        if (model === 'gpt-6-sol' || model === 'gpt-6-luna') {
          assert.equal(sent.body.reasoning_effort, 'none', 'Chat Completions tools require none')
        }
        if (preset.id === 'deepseek') {
          assert.deepEqual(sent.body.thinking, { type: 'enabled' })
          assert.equal(sent.body.reasoning_effort, 'low')
        }
        assert.equal(reply.tool_calls[0].id, 'call-1')
        await requestChat(
          [
            { role: 'user', content: 'Look up a tag' },
            reply,
            { role: 'tool', content: '{}', tool_call_id: 'call-1' },
          ],
          settings,
          { tools },
        )
        assert.equal(sent.body.messages[1].reasoning_content, 'fixture reasoning')
        assert.equal(sent.body.messages[2].tool_call_id, 'call-1')
      }
    }
    await requestChat(
      [{ role: 'user', content: 'hello' }],
      {
        apiKey: 'fixture-custom',
        baseUrl: 'https://custom.invalid/v1/',
        model: 'custom-model',
        reasoningEffort: 'off',
      },
      { temperature: 0.3 },
    )
    assert.equal(sent.url, 'https://custom.invalid/v1/chat/completions')
    assert.equal(sent.body.temperature, 0.3)
    console.log(
      'PASS preset request parameters, tool round trips, JSON mode and custom endpoint; no network traffic',
    )
    app.exit(0)
  } catch (error) {
    console.error(error)
    app.exit(1)
  }
})
