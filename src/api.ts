import type { TraceEvent } from './trace'

export async function createRun(query: string, repositoryPath: string, model: string) {
  const response = await fetch('/api/runs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, repositoryPath, model }),
  })
  const body = await response.json() as { runId?: string; error?: string }
  if (!response.ok || !body.runId) throw new Error(body.error ?? 'Unable to start run.')
  return body.runId
}

export function streamRun(
  runId: string,
  onEvent: (event: TraceEvent) => void,
  onDisconnect: () => void,
) {
  const source = new EventSource(`/api/runs/${encodeURIComponent(runId)}/events`)
  source.onmessage = (message) => onEvent(JSON.parse(message.data) as TraceEvent)
  source.onerror = () => {
    source.close()
    onDisconnect()
  }
  return () => source.close()
}

export async function cancelRun(runId: string) {
  const response = await fetch(`/api/runs/${encodeURIComponent(runId)}/cancel`, {
    method: 'POST',
  })
  if (!response.ok) {
    const body = await response.json() as { error?: string }
    throw new Error(body.error ?? 'Unable to cancel run.')
  }
}
