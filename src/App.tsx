import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { cancelRun, createRun, streamRun } from './api'
import type { AdoMcpConfig } from './api'
import { deriveTrace } from './trace'
import type { ToolCall, TraceEvent } from './trace'
import BenchmarkPage from './BenchmarkPage'
import './App.css'

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const paths: Record<string, ReactNode> = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
    history: <><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5M12 7v5l3 2" /></>,
    chart: <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" /></>,
    code: <><path d="m8 9-3 3 3 3M16 9l3 3-3 3M14 6l-4 12" /></>,
    spark: <><path d="m12 3 1.4 4.2L18 9l-4.6 1.8L12 15l-1.4-4.2L6 9l4.6-1.8z" /></>,
    arrow: <><path d="M5 12h14M14 7l5 5-5 5" /></>,
    copy: <><rect x="8" y="8" width="11" height="11" rx="2" /><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" /></>,
    chevron: <path d="m9 18 6-6-6-6" />,
    zap: <path d="M13 2 4 14h7l-1 8 9-12h-7z" />,
    stop: <rect x="6" y="6" width="12" height="12" rx="2" />,
  }
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}

function formatDuration(value = 0) {
  return value < 1000 ? `${value} ms` : `${(value / 1000).toFixed(1)} s`
}

function ToolIcon({ call, small = false }: { call: ToolCall; small?: boolean }) {
  const color = call.status === 'failed' ? '#dd6f61' : call.status === 'running' ? '#e9a23b' : '#2ea872'
  return <span className={`tool-icon ${small ? 'small' : ''}`} style={{ color, backgroundColor: `${color}14` }}><Icon name="code" size={small ? 14 : 19} /></span>
}

function App() {
  const [page, setPage] = useState<'trace' | 'benchmark'>(
    window.location.hash === '#benchmarks' ? 'benchmark' : 'trace',
  )
  const [query, setQuery] = useState('Explain how the main application flow works in this codebase')
  const [repositoryPath, setRepositoryPath] = useState('C:\\azure-devops-mcp')
  const [model, setModel] = useState('')
  const [adoMcpMode, setAdoMcpMode] = useState<AdoMcpConfig['mode']>('compare')
  const [adoOrganization, setAdoOrganization] = useState('sichauhan')
  const [adoProject, setAdoProject] = useState('MyFirstProject')
  const [adoRepository, setAdoRepository] = useState('azure-devops-remote-mcp')
  const [adoBranch, setAdoBranch] = useState('master')
  const [adoLocalPath, setAdoLocalPath] = useState('C:\\azure-devops-mcp')
  const [submittedAdoMcpMode, setSubmittedAdoMcpMode] = useState<AdoMcpConfig['mode']>('compare')
  const [selectedVariant, setSelectedVariant] = useState<'regular' | 'summary'>('regular')
  const [submittedQuery, setSubmittedQuery] = useState('')
  const [runId, setRunId] = useState('')
  const [events, setEvents] = useState<TraceEvent[]>([])
  const [streamActive, setStreamActive] = useState(false)
  const [requestError, setRequestError] = useState('')
  const [selectedCall, setSelectedCall] = useState<string | null>(null)
  const closeStream = useRef<(() => void) | null>(null)
  const visibleEvents = useMemo(
    () => submittedAdoMcpMode === 'compare'
      ? events.filter((event) => event.source === selectedVariant)
      : events,
    [events, selectedVariant, submittedAdoMcpMode],
  )
  const trace = useMemo(() => deriveTrace(visibleEvents), [visibleEvents])
  const selected = trace.tools.find((call) => call.id === selectedCall)
  const inputTokens = trace.usage.reduce((sum, call) => sum + call.inputTokens, 0)
  const outputTokens = trace.usage.reduce((sum, call) => sum + call.outputTokens, 0)
  const sessionCost = trace.metrics?.totalPremiumRequestCost
  const isActive = streamActive

  useEffect(() => () => closeStream.current?.(), [])

  async function runTrace(event: FormEvent) {
    event.preventDefault()
    if (!query.trim() || !repositoryPath.trim() || isActive) return
    closeStream.current?.()
    setEvents([])
    setRequestError('')
    setSelectedCall(null)
    setSubmittedQuery(query.trim())
    setSubmittedAdoMcpMode(adoMcpMode)
    setSelectedVariant('regular')
    try {
      const id = await createRun(query.trim(), repositoryPath.trim(), model.trim(), {
        mode: adoMcpMode,
        organization: adoOrganization.trim(),
        project: adoProject.trim(),
        repository: adoRepository.trim(),
        branch: adoBranch.trim(),
        localPath: adoLocalPath.trim(),
      })
      setRunId(id)
      setStreamActive(true)
      setEvents(adoMcpMode === 'compare'
        ? [
            { id: 'regular-start', type: 'run.starting', timestamp: new Date().toISOString(), data: {}, source: 'regular' },
            { id: 'summary-start', type: 'run.starting', timestamp: new Date().toISOString(), data: {}, source: 'summary' },
          ]
        : [{ id: 'run-start', type: 'run.starting', timestamp: new Date().toISOString(), data: {} }])
      closeStream.current = streamRun(
        id,
        (traceEvent) => setEvents((current) => current.some((item) => item.id === traceEvent.id) ? current : [...current, traceEvent]),
        () => {
          closeStream.current = null
          setStreamActive(false)
        },
      )
    } catch (error) {
      setStreamActive(false)
      setRequestError(error instanceof Error ? error.message : 'Unable to start run.')
    }
  }

  async function stopRun() {
    if (!runId) return
    try {
      await cancelRun(runId)
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : 'Unable to cancel run.')
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark"><Icon name="zap" size={16} /></span><span>Traceflow</span></div>
        <nav>
          <p className="nav-label">Workspace</p>
          <button className={`nav-item ${page === 'trace' ? 'active' : ''}`} type="button" onClick={() => { setPage('trace'); window.location.hash = 'overview' }}><Icon name="grid" /><span>Live trace</span></button>
          <button className={`nav-item ${page === 'benchmark' ? 'active' : ''}`} type="button" onClick={() => { setPage('benchmark'); window.location.hash = 'benchmarks' }}><Icon name="chart" /><span>Benchmarks</span></button>
          {page === 'trace' && <a className="nav-item" href="#events"><Icon name="history" /><span>Event log</span></a>}
          <a className="nav-item" href="#usage"><Icon name="chart" /><span>Usage</span></a>
          <p className="nav-label second">Local</p>
          <a className="nav-item" href="#settings"><Icon name="settings" /><span>Connection</span></a>
        </nav>
        <div className="usage-widget">
          <div className="usage-heading"><span>Session cost</span><strong>{sessionCost?.toFixed(2) ?? 'Pending'}</strong></div>
          <div className="usage-track"><span style={{ width: `${Math.min((sessionCost ?? 0) * 10, 100)}%` }} /></div>
          <p>Final premium-request cost</p>
        </div>
      </aside>

      <main>
        <header className="topbar">
          <div className="breadcrumb"><span>Local Copilot</span><Icon name="chevron" size={14} /><strong>Live trace</strong></div>
          <div className="header-actions"><span className={`live-dot ${isActive ? 'pulse' : ''}`} /> {isActive ? 'Tracing' : 'Ready'}</div>
        </header>

        {page === 'benchmark' ? <BenchmarkPage /> : <div className="content" id="overview">
          <section className="intro">
            <div><h1>Agent trace explorer</h1><p>Observe Copilot tool calls and model usage for one complete codebase query.</p></div>
            {runId && <div className="run-meta"><span>RUN ID</span><button type="button" onClick={() => void navigator.clipboard.writeText(runId)}>{runId} <Icon name="copy" size={14} /></button></div>}
          </section>

          <form className="query-card" onSubmit={runTrace}>
            <div className="field-grid">
              <label>Repository path<input value={repositoryPath} onChange={(event) => setRepositoryPath(event.target.value)} disabled={isActive} /></label>
              <label>Model (optional)<input value={model} onChange={(event) => setModel(event.target.value)} placeholder="Copilot default" disabled={isActive} /></label>
            </div>
            <div className="field-grid mcp-grid">
              <label>ADO MCP
                <select value={adoMcpMode} onChange={(event) => setAdoMcpMode(event.target.value as AdoMcpConfig['mode'])} disabled={isActive}>
                  <option value="none">Disabled</option>
                  <option value="regular">Regular DevFabric toolset</option>
                  <option value="summary">DevFabric toolset with summaries</option>
                  <option value="compare">Compare regular vs. summaries</option>
                </select>
              </label>
              <label>Azure DevOps organization<input value={adoOrganization} onChange={(event) => setAdoOrganization(event.target.value)} disabled={isActive || adoMcpMode === 'none'} /></label>
            </div>
            {adoMcpMode !== 'none' && <>
              <div className="field-grid scope-grid">
                <label>Azure DevOps project<input value={adoProject} onChange={(event) => setAdoProject(event.target.value)} disabled={isActive} /></label>
                <label>Repository name or ID<input value={adoRepository} onChange={(event) => setAdoRepository(event.target.value)} disabled={isActive} /></label>
                <label>Branch<input value={adoBranch} onChange={(event) => setAdoBranch(event.target.value)} disabled={isActive} /></label>
              </div>
              <label className="wide-field">ADO MCP source path<input value={adoLocalPath} onChange={(event) => setAdoLocalPath(event.target.value)} disabled={isActive} /></label>
            </>}
            <label htmlFor="agent-query">Ask Copilot about this codebase</label>
            <div className="query-row">
              <textarea id="agent-query" value={query} onChange={(event) => setQuery(event.target.value)} rows={2} disabled={isActive} />
              {isActive
                ? <button className="run-button stop-button" type="button" onClick={() => void stopRun()}><Icon name="stop" /> Cancel</button>
                : <button className="run-button" type="submit" disabled={!query.trim() || !repositoryPath.trim()}><Icon name="arrow" /> Run trace</button>}
            </div>
            <div className="query-footer"><span>Copilot runs locally with tool permissions enabled</span><span>ADO tools use the selected MCP source</span></div>
            {(requestError || trace.error) && <p className="error-banner">{requestError || trace.error}</p>}
          </form>

          {submittedAdoMcpMode === 'compare' && runId &&
            <div className="comparison-tabs" role="tablist" aria-label="ADO MCP trace">
              <button className={selectedVariant === 'regular' ? 'active' : ''} type="button" onClick={() => { setSelectedVariant('regular'); setSelectedCall(null) }}>Regular DevFabric MCP</button>
              <button className={selectedVariant === 'summary' ? 'active' : ''} type="button" onClick={() => { setSelectedVariant('summary'); setSelectedCall(null) }}>DevFabric MCP + summaries</button>
            </div>}

          <section className="stats-grid" id="usage">
            <article><span className="stat-icon purple"><Icon name="zap" /></span><div><p>Query cost</p><strong>{sessionCost?.toFixed(2) ?? '—'}</strong><span>Final premium-request cost</span></div></article>
            <article><span className="stat-icon green"><Icon name="history" /></span><div><p>Model time</p><strong>{formatDuration(trace.metrics?.totalApiDurationMs ?? 0)}</strong><span>{trace.usage.length} model calls</span></div></article>
            <article><span className="stat-icon amber"><Icon name="code" /></span><div><p>Tool calls</p><strong>{trace.tools.length}</strong><span>No direct tool cost</span></div></article>
            <article><span className="stat-icon coral"><Icon name="spark" /></span><div><p>Tokens</p><strong>{(inputTokens + outputTokens).toLocaleString()}</strong><span>{inputTokens.toLocaleString()} in / {outputTokens.toLocaleString()} out</span></div></article>
          </section>

          <section className="panel trace-panel">
            <div className="panel-title"><div><h2>Execution flow</h2><p>Tool calls appear here as Copilot executes them</p></div><span className={`status-pill ${trace.status}`}><i /> {trace.status}</span></div>
            <div className="flow">
              <div className="flow-start"><span>User query</span><strong>{submittedQuery || 'Submit a query to begin'}</strong></div>
              {trace.tools.map((call) => (
                <div className="flow-segment" key={call.id}>
                  <div className="flow-arrow"><Icon name="arrow" size={17} /></div>
                  <button type="button" className={`flow-node ${selectedCall === call.id ? 'selected' : ''}`} onClick={() => setSelectedCall(selectedCall === call.id ? null : call.id)}>
                    <ToolIcon call={call} /><span><strong>{call.name}</strong><small>{call.status}</small></span>
                  </button>
                </div>
              ))}
              {isActive && trace.tools.length === 0 && <span className="waiting"><span className="spinner" /> Waiting for Copilot events...</span>}
            </div>
            {selected &&
              <div className="call-detail">
                <div className="call-detail-summary">
                  <ToolIcon call={selected} small />
                  <strong>{selected.name}</strong>
                  <span>{selected.detail}</span>
                  <span>{formatDuration(selected.durationMs)}</span>
                  <b>{selected.model ?? 'model unknown'}</b>
                </div>
                <div className="call-output">
                  <div><strong>Output</strong><span>{(selected.outputTokens ?? 0).toLocaleString()} tokens</span></div>
                  <pre>{selected.output || 'No output was captured for this tool call.'}</pre>
                </div>
              </div>}
          </section>

          <div className="lower-grid" id="events">
            <section className="panel call-log">
              <div className="panel-title"><div><h2>Tool call log</h2><p>Click any call to inspect its complete output</p></div><span className="scope-note">Exact o200k output tokens</span></div>
              <div className="table-head"><span>Tool</span><span>Duration</span><span>Tokens</span><span>Status</span></div>
              {trace.tools.length === 0 && <p className="empty-state">No tool calls observed yet.</p>}
              {trace.tools.map((call) => (
                <div className={`table-entry ${selectedCall === call.id ? 'selected' : ''}`} key={call.id}>
                  <button className="table-row" type="button" onClick={() => setSelectedCall(selectedCall === call.id ? null : call.id)}>
                    <span className="tool-cell"><ToolIcon call={call} small /><span><strong>{call.name}</strong><small>{call.detail}</small></span></span>
                    <span>{formatDuration(call.durationMs)}</span>
                    <span>{call.status === 'running' ? '—' : (call.outputTokens ?? 0).toLocaleString()}</span>
                    <strong>{call.status}</strong>
                  </button>
                  {selectedCall === call.id &&
                    <div className="table-output">
                      <div><strong>Tool output</strong><span>{(call.outputTokens ?? 0).toLocaleString()} tokens</span></div>
                      <pre>{call.output || 'No output was captured for this tool call.'}</pre>
                    </div>}
                </div>
              ))}
            </section>

            <section className="panel credit-panel">
              <div className="panel-title"><div><h2>Model usage</h2><p>Token and cost events for the full query</p></div></div>
              <div className="usage-list">
                {trace.usage.length === 0 && <p className="empty-state">No model usage reported yet.</p>}
                {trace.usage.map((call, index) => (
                  <div className="usage-row" key={call.id}><span>{index + 1}</span><div><strong>{call.model}</strong><small>{call.initiator ?? 'main agent'} · {call.inputTokens.toLocaleString()} in / {call.outputTokens.toLocaleString()} out</small></div><b>{call.multiplier.toFixed(2)}×</b></div>
                ))}
              </div>
            </section>
          </div>

          {(trace.answer || trace.status === 'completed') && <section className="panel answer-panel"><div className="panel-title"><div><h2>Final answer</h2><p>Copilot response for this run</p></div></div><div className="answer-content">{trace.answer || 'The run completed without a final text response.'}</div></section>}
        </div>}
      </main>
    </div>
  )
}

export default App
