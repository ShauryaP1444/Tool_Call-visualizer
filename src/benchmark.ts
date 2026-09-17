import type { AdoMcpConfig } from './api'
import type { TraceEvent } from './trace'

export type BenchmarkQuestion = {
  id: string
  topicGroup: string
  category: string
  difficulty: string
  answerability: string
  question: string
  maximumScore: number
}

export type BenchmarkDataset = {
  metadata: {
    name: string
    repository: string
    branch: string
    commit: string
    grading: string
  }
  questions: BenchmarkQuestion[]
}

export type BenchmarkPointScore = {
  id: string
  description: string
  weight: number
  earned: number
  rationale: string
}

export type BenchmarkCriticalError = {
  description: string
  present: boolean
  rationale: string
}

export type BenchmarkUsage = {
  model: string
  requests: number
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  durationMs: number
}

export type BenchmarkResult = {
  questionId: string
  mode: 'regular' | 'summary'
  question: string
  topicGroup: string
  category: string
  difficulty: string
  answer: string
  answerUsage: BenchmarkUsage
  evaluatorUsage: BenchmarkUsage
  toolStats: {
    calls: number
    failures: number
    outputTokens: number
    byTool: Record<string, number>
  }
  evaluation: {
    score: number
    rawScore: number
    maximumScore: number
    criticalErrorCapApplied: boolean
    points: BenchmarkPointScore[]
    criticalErrors: BenchmarkCriticalError[]
    assessment: string
  }
}

export type BenchmarkAggregate = {
  mode: 'regular' | 'summary'
  completed: number
  averageScore: number
  totalAnswerTokens: number
  totalEvaluatorTokens: number
  averageDurationMs: number
  totalToolCalls: number
  totalToolOutputTokens: number
  criticalErrors: number
}

export type BenchmarkReport = {
  runId: string
  status: string
  selectedQuestions: string[]
  results: BenchmarkResult[]
  failures: Array<{ questionId: string; mode: string; message: string }>
  aggregate: BenchmarkAggregate[]
}

export async function loadBenchmarkQuestions() {
  const response = await fetch('/api/benchmarks/questions')
  const body = await response.json() as BenchmarkDataset & { error?: string }
  if (!response.ok) throw new Error(body.error ?? 'Unable to load benchmark questions.')
  return body
}

export async function createBenchmarkRun(options: {
  questionIds: string[]
  runAll: boolean
  mode: 'regular' | 'summary' | 'compare'
  answerModel: string
  evaluatorModel: string
  repositoryPath: string
  adoMcp: AdoMcpConfig
}) {
  const response = await fetch('/api/benchmarks/runs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(options),
  })
  const body = await response.json() as { runId?: string; error?: string }
  if (!response.ok || !body.runId) throw new Error(body.error ?? 'Unable to start benchmark.')
  return body.runId
}

export function streamBenchmarkRun(
  runId: string,
  onEvent: (event: TraceEvent) => void,
  onDisconnect: () => void,
) {
  const source = new EventSource(`/api/benchmarks/runs/${encodeURIComponent(runId)}/events`)
  source.onmessage = (message) => onEvent(JSON.parse(message.data) as TraceEvent)
  source.onerror = () => {
    source.close()
    onDisconnect()
  }
  return () => source.close()
}

export async function cancelBenchmarkRun(runId: string) {
  const response = await fetch(`/api/benchmarks/runs/${encodeURIComponent(runId)}/cancel`, {
    method: 'POST',
  })
  if (!response.ok) {
    const body = await response.json() as { error?: string }
    throw new Error(body.error ?? 'Unable to cancel benchmark.')
  }
}
