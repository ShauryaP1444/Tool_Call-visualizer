import { useEffect, useMemo, useRef, useState } from 'react'
import {
  cancelBenchmarkRun,
  createBenchmarkRun,
  loadBenchmarkQuestions,
  streamBenchmarkRun,
} from './benchmark'
import type {
  BenchmarkAggregate,
  BenchmarkDataset,
  BenchmarkReport,
  BenchmarkResult,
} from './benchmark'
import type { AdoMcpConfig } from './api'
import type { TraceEvent } from './trace'

function formatDuration(value = 0) {
  return value < 1000 ? `${value} ms` : `${(value / 1000).toFixed(1)} s`
}

function downloadReport(report: BenchmarkReport) {
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${report.runId}.json`
  anchor.click()
  URL.revokeObjectURL(url)
}

function AggregateCard({ aggregate }: { aggregate: BenchmarkAggregate }) {
  return (
    <article className={`aggregate-card ${aggregate.mode}`}>
      <div><span>{aggregate.mode}</span><strong>{aggregate.averageScore.toFixed(2)}/10</strong></div>
      <dl>
        <div><dt>Questions</dt><dd>{aggregate.completed}</dd></div>
        <div><dt>Total session tokens</dt><dd>{aggregate.totalAnswerTokens.toLocaleString()}</dd></div>
        <div><dt>Tool-output tokens</dt><dd>{aggregate.totalToolOutputTokens.toLocaleString()}</dd></div>
        <div><dt>Tool calls</dt><dd>{aggregate.totalToolCalls.toLocaleString()}</dd></div>
        <div><dt>Average time</dt><dd>{formatDuration(aggregate.averageDurationMs)}</dd></div>
        <div><dt>Critical errors</dt><dd>{aggregate.criticalErrors}</dd></div>
      </dl>
    </article>
  )
}

function ResultCard({ result }: { result: BenchmarkResult }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <article className={`benchmark-result ${result.mode}`}>
      <button type="button" className="benchmark-result-header" onClick={() => setExpanded(!expanded)}>
        <span className="benchmark-score">{result.evaluation.score.toFixed(2)}</span>
        <span>
          <strong>{result.questionId} · {result.mode}</strong>
          <small>{result.question}</small>
        </span>
        <span className="benchmark-result-metrics">
          {result.answerUsage.requests} model calls · {(result.answerUsage.inputTokens + result.answerUsage.outputTokens).toLocaleString()} tokens · {formatDuration(result.answerUsage.durationMs)}
        </span>
      </button>
      {expanded && (
        <div className="benchmark-result-body">
          <section>
            <h3>Evaluator assessment</h3>
            <p>{result.evaluation.assessment || 'No overall assessment returned.'}</p>
            {result.evaluation.criticalErrorCapApplied && <p className="benchmark-warning">Critical-error cap applied.</p>}
            <div className="rubric-list">
              {result.evaluation.points.map((point) => (
                <div key={point.id}>
                  <strong>{point.id}: {point.earned}/{point.weight}</strong>
                  <span>{point.description}</span>
                  <p>{point.rationale}</p>
                </div>
              ))}
            </div>
            <h3>Critical errors</h3>
            <div className="critical-list">
              {result.evaluation.criticalErrors.map((error) => (
                <div className={error.present ? 'present' : ''} key={error.description}>
                  <strong>{error.present ? 'Detected' : 'Not detected'}</strong>
                  <span>{error.description}</span>
                  {error.rationale && <p>{error.rationale}</p>}
                </div>
              ))}
            </div>
          </section>
          <section>
            <h3>Candidate answer</h3>
            <pre>{result.answer}</pre>
            <h3>Execution metrics</h3>
            <dl className="result-metric-grid">
              <div><dt>Total session tokens</dt><dd>{(result.answerUsage.inputTokens + result.answerUsage.outputTokens).toLocaleString()}</dd></div>
              <div><dt>Input tokens</dt><dd>{result.answerUsage.inputTokens.toLocaleString()}</dd></div>
              <div><dt>Output tokens</dt><dd>{result.answerUsage.outputTokens.toLocaleString()}</dd></div>
              <div><dt>Model calls</dt><dd>{result.answerUsage.requests}</dd></div>
              <div><dt>Tool calls</dt><dd>{result.toolStats.calls}</dd></div>
              <div><dt>Tool failures</dt><dd>{result.toolStats.failures}</dd></div>
              <div><dt>Tool-output tokens</dt><dd>{result.toolStats.outputTokens.toLocaleString()}</dd></div>
            </dl>
          </section>
        </div>
      )}
    </article>
  )
}

export default function BenchmarkPage() {
  const [dataset, setDataset] = useState<BenchmarkDataset | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [topic, setTopic] = useState('all')
  const [mode, setMode] = useState<'regular' | 'summary' | 'compare'>('compare')
  const [answerModel, setAnswerModel] = useState('gpt-5.6-sol')
  const [evaluatorModel, setEvaluatorModel] = useState('gpt-5.6-sol')
  const [repositoryPath, setRepositoryPath] = useState('C:\\azure-devops-mcp')
  const [adoMcp, setAdoMcp] = useState<AdoMcpConfig>({
    mode: 'compare',
    organization: 'sichauhan',
    project: 'MyFirstProject',
    repository: 'azure-devops-remote-mcp',
    branch: 'master',
    localPath: 'C:\\azure-devops-mcp',
  })
  const [events, setEvents] = useState<TraceEvent[]>([])
  const [runId, setRunId] = useState('')
  const [active, setActive] = useState(false)
  const [error, setError] = useState('')
  const closeStream = useRef<(() => void) | null>(null)

  useEffect(() => {
    void loadBenchmarkQuestions()
      .then((loaded) => {
        setDataset(loaded)
        setSelectedIds(new Set(loaded.questions.slice(0, 1).map((question) => question.id)))
      })
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : String(loadError)))
    return () => closeStream.current?.()
  }, [])

  const topics = useMemo(
    () => [...new Set(dataset?.questions.map((question) => question.topicGroup) ?? [])],
    [dataset],
  )
  const visibleQuestions = useMemo(
    () => dataset?.questions.filter((question) => topic === 'all' || question.topicGroup === topic) ?? [],
    [dataset, topic],
  )
  const results = useMemo(
    () => events
      .filter((event) => event.type === 'benchmark.variant_completed')
      .map((event) => event.data as unknown as BenchmarkResult),
    [events],
  )
  const report = useMemo(() => {
    const finalEvent = [...events].reverse().find(
      (event) => event.type === 'benchmark.completed' || event.type === 'benchmark.cancelled',
    )
    return finalEvent?.data as unknown as BenchmarkReport | undefined
  }, [events])
  const currentQuestion = useMemo(() => {
    const event = [...events].reverse().find((item) => item.type === 'benchmark.question_started')
    return event?.data as { questionId?: string; index?: number; total?: number } | undefined
  }, [events])

  function toggleQuestion(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function startBenchmark(runAll: boolean) {
    if (active) return
    setError('')
    setEvents([])
    try {
      const id = await createBenchmarkRun({
        questionIds: [...selectedIds],
        runAll,
        mode,
        answerModel,
        evaluatorModel,
        repositoryPath,
        adoMcp: { ...adoMcp, mode },
      })
      setRunId(id)
      setActive(true)
      closeStream.current = streamBenchmarkRun(
        id,
        (event) => setEvents((current) => current.some((item) => item.id === event.id) ? current : [...current, event]),
        () => {
          closeStream.current = null
          setActive(false)
        },
      )
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : String(runError))
    }
  }

  async function stopBenchmark() {
    if (!runId) return
    try {
      await cancelBenchmarkRun(runId)
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : String(cancelError))
    }
  }

  return (
    <div className="content benchmark-page">
      <section className="intro">
        <div><h1>Repository benchmark</h1><p>Run source-grounded questions and grade answers with an isolated evaluator model.</p></div>
        {runId && <div className="run-meta"><span>BENCHMARK RUN</span><button type="button" onClick={() => void navigator.clipboard.writeText(runId)}>{runId}</button></div>}
      </section>

      <section className="panel benchmark-config">
        <div className="panel-title"><div><h2>Run configuration</h2><p>{dataset?.metadata.name ?? 'Loading dataset...'}</p></div><span className={`status-pill ${active ? 'running' : report?.status ?? 'idle'}`}><i /> {active ? 'running' : report?.status ?? 'ready'}</span></div>
        <div className="benchmark-config-body">
          <div className="field-grid">
            <label>Answer model<input value={answerModel} onChange={(event) => setAnswerModel(event.target.value)} disabled={active} /></label>
            <label>Evaluator model<input value={evaluatorModel} onChange={(event) => setEvaluatorModel(event.target.value)} disabled={active} /></label>
          </div>
          <div className="field-grid">
            <label>Mode<select value={mode} onChange={(event) => setMode(event.target.value as typeof mode)} disabled={active}><option value="regular">Regular only</option><option value="summary">Summary only</option><option value="compare">Compare both</option></select></label>
            <label>Local working directory<input value={repositoryPath} onChange={(event) => setRepositoryPath(event.target.value)} disabled={active} /></label>
          </div>
          <div className="field-grid scope-grid">
            <label>Organization<input value={adoMcp.organization} onChange={(event) => setAdoMcp({ ...adoMcp, organization: event.target.value })} disabled={active} /></label>
            <label>Project<input value={adoMcp.project} onChange={(event) => setAdoMcp({ ...adoMcp, project: event.target.value })} disabled={active} /></label>
            <label>Branch<input value={adoMcp.branch} onChange={(event) => setAdoMcp({ ...adoMcp, branch: event.target.value })} disabled={active} /></label>
          </div>
          <div className="field-grid">
            <label>Repository<input value={adoMcp.repository} onChange={(event) => setAdoMcp({ ...adoMcp, repository: event.target.value })} disabled={active} /></label>
            <label>ADO MCP source path<input value={adoMcp.localPath} onChange={(event) => setAdoMcp({ ...adoMcp, localPath: event.target.value })} disabled={active} /></label>
          </div>
          {error && <p className="error-banner">{error}</p>}
        </div>
      </section>

      <section className="panel benchmark-questions">
        <div className="panel-title">
          <div><h2>Questions</h2><p>{selectedIds.size} of {dataset?.questions.length ?? 0} selected</p></div>
          <div className="benchmark-actions">
            <select value={topic} onChange={(event) => setTopic(event.target.value)} disabled={active}>
              <option value="all">All topics</option>
              {topics.map((item) => <option value={item} key={item}>{item}</option>)}
            </select>
            <button type="button" onClick={() => setSelectedIds(new Set(visibleQuestions.map((question) => question.id)))} disabled={active}>Select visible</button>
            <button type="button" onClick={() => setSelectedIds(new Set())} disabled={active}>Clear</button>
          </div>
        </div>
        <div className="question-list">
          {visibleQuestions.map((question) => (
            <label className="question-row" key={question.id}>
              <input type="checkbox" checked={selectedIds.has(question.id)} onChange={() => toggleQuestion(question.id)} disabled={active} />
              <span><strong>{question.id}</strong><small>{question.topicGroup} · {question.category} · {question.difficulty}</small></span>
              <p>{question.question}</p>
            </label>
          ))}
        </div>
        <div className="benchmark-run-bar">
          <span>{currentQuestion?.questionId ? `Running ${currentQuestion.questionId} (${(currentQuestion.index ?? 0) + 1}/${currentQuestion.total})` : 'Ready to run'}</span>
          {active
            ? <button className="run-button stop-button" type="button" onClick={() => void stopBenchmark()}>Cancel</button>
            : <>
                <button type="button" onClick={() => void startBenchmark(false)} disabled={!selectedIds.size}>Run selected</button>
                <button className="run-button" type="button" onClick={() => void startBenchmark(true)} disabled={!dataset?.questions.length}>Run all</button>
              </>}
        </div>
      </section>

      {(report?.aggregate.length || results.length > 0) && (
        <section className="benchmark-report">
          <div className="benchmark-report-title"><div><h2>Score report</h2><p>Weighted semantic grading; critical errors cap a result at 5/10.</p></div>{report && <button type="button" onClick={() => downloadReport(report)}>Download JSON</button>}</div>
          {report && <div className="aggregate-grid">{report.aggregate.map((aggregate) => <AggregateCard aggregate={aggregate} key={aggregate.mode} />)}</div>}
          <div className="benchmark-results">
            {results.map((result) => <ResultCard result={result} key={`${result.questionId}-${result.mode}`} />)}
          </div>
          {report?.failures.map((failure) => <p className="error-banner" key={`${failure.questionId}-${failure.mode}`}>{failure.questionId} · {failure.mode}: {failure.message}</p>)}
        </section>
      )}
    </div>
  )
}
