export type RunStatus = 'idle' | 'starting' | 'running' | 'completed' | 'failed' | 'cancelled'

export type TraceEvent = {
  id: string
  type: string
  timestamp: string
  data: Record<string, unknown>
  source?: string
}

export type ToolCall = {
  id: string
  name: string
  detail: string
  model?: string
  status: 'running' | 'completed' | 'failed'
  startedAt: string
  durationMs?: number
  output: string
  outputTokens?: number
}

export type UsageCall = {
  id: string
  model: string
  inputTokens: number
  outputTokens: number
  multiplier: number
  durationMs: number
  initiator?: string
}

export type SessionMetrics = {
  totalPremiumRequestCost?: number
  totalNanoAiu?: number
  totalApiDurationMs?: number
  totalUserRequests?: number
  currentModel?: string
}

export function describeArguments(value: unknown) {
  if (value === undefined) return 'No arguments'
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return text.length > 90 ? `${text.slice(0, 87)}...` : text
}

export function deriveTrace(events: TraceEvent[]) {
  const tools = new Map<string, ToolCall>()
  const usage: UsageCall[] = []
  let status: RunStatus = events.length ? 'starting' : 'idle'
  let answer = ''
  let error = ''
  let metrics: SessionMetrics | undefined
  let turns = 0

  for (const event of events) {
    const data = event.data
    if (event.type === 'run.started') status = 'running'
    if (event.type === 'assistant.turn_start') turns += 1
    if (event.type === 'assistant.message' && typeof data.content === 'string') answer = data.content
    if (event.type === 'session.error' && typeof data.message === 'string') error = data.message

    if (event.type === 'tool.execution_start' && typeof data.toolCallId === 'string') {
      tools.set(data.toolCallId, {
        id: data.toolCallId,
        name: typeof data.toolName === 'string' ? data.toolName : 'unknown tool',
        detail: describeArguments(data.arguments),
        model: typeof data.model === 'string' ? data.model : undefined,
        status: 'running',
        startedAt: event.timestamp,
        output: '',
      })
    }
    if (event.type === 'tool.execution_complete' && typeof data.toolCallId === 'string') {
      const existing = tools.get(data.toolCallId)
      if (existing) {
        tools.set(data.toolCallId, {
          ...existing,
          status: data.success === false ? 'failed' : 'completed',
          durationMs: new Date(event.timestamp).getTime() - new Date(existing.startedAt).getTime(),
          output: typeof data.toolOutput === 'string' ? data.toolOutput : '',
          outputTokens: typeof data.toolOutputTokens === 'number' ? data.toolOutputTokens : 0,
        })
      }
    }
    if (event.type === 'assistant.usage') {
      usage.push({
        id: event.id,
        model: typeof data.model === 'string' ? data.model : 'unknown',
        inputTokens: typeof data.inputTokens === 'number' ? data.inputTokens : 0,
        outputTokens: typeof data.outputTokens === 'number' ? data.outputTokens : 0,
        multiplier: typeof data.cost === 'number' ? data.cost : 0,
        durationMs: typeof data.duration === 'number' ? data.duration : 0,
        initiator: typeof data.initiator === 'string' ? data.initiator : undefined,
      })
    }
    if (event.type === 'run.completed') {
      status = 'completed'
      if (typeof data.answer === 'string') answer = data.answer
      metrics = data.metrics as SessionMetrics
    }
    if (event.type === 'run.failed') {
      status = 'failed'
      error = typeof data.message === 'string' ? data.message : 'The run failed.'
    }
    if (event.type === 'run.cancelled') status = 'cancelled'
  }

  return { tools: [...tools.values()], usage, status, answer, error, metrics, turns }
}
