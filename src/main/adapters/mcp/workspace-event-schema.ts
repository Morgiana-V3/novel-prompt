import type { Schema } from './schema'

const text = { type: 'string' }
const number = { type: 'number' }
const strings = { type: 'array', items: text }
const base = {
  schema: { type: 'integer', enum: [1] },
  severity: { type: 'string', enum: ['info', 'warning', 'error'] },
}
const event = (properties: Record<string, Schema>, required: string[]): Schema => ({
  type: 'object',
  properties: { ...base, ...properties },
  required: ['schema', 'severity', 'type', ...required],
  additionalProperties: true,
})

export const pageBillingSchema: Schema = {
  type: 'object',
  description: 'Recorded balance observation, not a provider billing receipt or current balance.',
  properties: {
    status: { type: 'string', enum: ['known', 'unknown', 'not-run'] },
    anlasDelta: number,
    usageDelta: number,
    remainingAnlas: number,
  },
  required: ['status'],
  additionalProperties: true,
}

export const pageExecutionEventSchema = event(
  {
    type: { enum: ['execution'] },
    kind: { enum: ['generate', 'inpaint', 'upscale', 'outpaint', 'enhance'] },
    sourceVersionId: text,
    versionIds: strings,
    adoptedVersionId: text,
    requestedCount: { type: 'integer' },
    status: { enum: ['complete', 'partial', 'failed'] },
    stopped: { type: ['string', 'null'] },
    billing: pageBillingSchema,
    error: text,
  },
  [
    'kind',
    'sourceVersionId',
    'versionIds',
    'adoptedVersionId',
    'requestedCount',
    'status',
    'stopped',
    'billing',
  ],
)

export const pageExecutionObservationSchema: Schema = {
  type: 'object',
  properties: {
    messageId: text,
    observedAt: number,
    event: pageExecutionEventSchema,
  },
  required: ['messageId', 'observedAt', 'event'],
  additionalProperties: true,
}

export const pageMessageEventSchema: Schema = {
  anyOf: [
    pageExecutionEventSchema,
    event(
      {
        type: { enum: ['proposal'] },
        messageId: text,
        title: text,
        decision: { enum: ['accepted', 'rejected', 'withdrawn'] },
      },
      ['messageId', 'title', 'decision'],
    ),
    event({ type: { enum: ['goal'] }, goal: text, preserve: text }, ['goal', 'preserve']),
    event({ type: { enum: ['agent'] }, mode: { enum: ['internal', 'external'] }, name: text }, [
      'mode',
    ]),
    event({ type: { enum: ['request-cancelled'] }, requestId: text }, ['requestId']),
    event(
      {
        type: { enum: ['legacy'] },
        category: {
          enum: ['execution', 'billing', 'proposal', 'goal', 'agent', 'version', 'state', 'error'],
        },
        billing: pageBillingSchema,
      },
      ['category'],
    ),
  ],
}
