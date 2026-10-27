/** The JSON Schema subset used by tool inputs, outputs and runtime validation.
 * Schemas are application definitions; values arriving from clients stay unknown.
 */
export interface Schema extends Record<string, unknown> {
  type?: string | string[]
  anyOf?: Schema[]
  enum?: readonly unknown[]
  properties?: Record<string, Schema>
  required?: string[]
  additionalProperties?: boolean | Schema
  items?: Schema
  minimum?: number
  maximum?: number
  minLength?: number
  maxLength?: number
  minItems?: number
  maxItems?: number
  maxProperties?: number
}
