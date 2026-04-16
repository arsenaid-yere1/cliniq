import { vi, type Mock } from 'vitest'
import Anthropic from '@anthropic-ai/sdk'

interface ToolUseResponseSpec {
  toolName: string
  input: Record<string, unknown>
  usage?: Partial<Anthropic.Messages.Usage>
}

export function mockToolUseResponse(spec: ToolUseResponseSpec): Anthropic.Message {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-4-6',
    stop_reason: 'tool_use',
    stop_sequence: null,
    content: [
      {
        type: 'tool_use',
        id: 'toolu_test',
        name: spec.toolName,
        input: spec.input,
      },
    ],
    usage: {
      input_tokens: 100,
      output_tokens: 200,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      ...spec.usage,
    },
  } as Anthropic.Message
}

export function createMockAnthropic() {
  const create = vi.fn() as Mock
  return {
    _create: create,
    messages: { create },
  }
}

export function makeApiError(status: number, message = 'api error'): InstanceType<typeof Anthropic.APIError> {
  const Cls =
    status === 429 ? Anthropic.RateLimitError
    : status === 401 ? Anthropic.AuthenticationError
    : status === 400 ? Anthropic.BadRequestError
    : status >= 500 ? Anthropic.InternalServerError
    : Anthropic.APIError
  return new Cls(status as never, { message }, message, new Headers())
}
