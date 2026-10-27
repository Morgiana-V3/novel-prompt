import {
  requestChat,
  type ChatInputMessage,
  type ChatMessage,
  type ChatOptions,
} from '../../providers/chat/client'
import { getSettings } from '../settings/service'

export function chat(
  messages: ChatInputMessage[],
  options: ChatOptions = {},
): Promise<ChatMessage> {
  return requestChat(messages, getSettings(), options)
}
