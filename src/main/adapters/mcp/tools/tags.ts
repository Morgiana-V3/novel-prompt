import { TAG_TOOL_DEFS, tagTool } from '../../../modules/prompts/optimizer'
import type { McpTool } from '../types'

export const tagDef = (name: string) =>
  TAG_TOOL_DEFS.find((tool) => tool.function.name === name)!.function

export function createTagTools(): McpTool[] {
  return (['search_tags', 'validate_tags', 'related_tags', 'tag_wiki'] as const).map(
    (name): McpTool => ({
      name,
      description: tagDef(name).description,
      inputSchema: tagDef(name).parameters,
      annotations: {
        readOnlyHint: true,
        openWorldHint: name === 'related_tags' || name === 'tag_wiki',
      },
      run: (argumentsRecord, signal) => tagTool(name, argumentsRecord, signal),
    }),
  )
}
