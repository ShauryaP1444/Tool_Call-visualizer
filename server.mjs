import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { CopilotClient, approveAll } from '@github/copilot-sdk'

const host = '127.0.0.1'
const port = Number(process.env.TRACEFLOW_PORT ?? 8787)
const runs = new Map()

function sendJson(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json' })
  response.end(JSON.stringify(body))
}

async function readJson(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > 64 * 1024) throw new Error('Request body exceeds 64 KB')
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function publish(run, type, data = {}) {
  const event = {
    id: randomUUID(),
    type,
    timestamp: new Date().toISOString(),
    data,
  }
  run.events.push(event)
  const message = `id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`
  for (const response of run.subscribers) response.write(message)
}

async function executeRun(run) {
  try {
    run.client = new CopilotClient({ workingDirectory: run.repositoryPath })
    await run.client.start()
    run.session = await run.client.createSession({
      clientName: 'traceflow',
      model: run.model || undefined,
      streaming: true,
      onPermissionRequest: approveAll,
    })
    run.session.on((event) => publish(run, event.type, event.data))
    run.status = 'running'
    publish(run, 'run.started', {
      runId: run.id,
      sessionId: run.session.sessionId,
      query: run.query,
      repositoryPath: run.repositoryPath,
    })

    const answer = await run.session.sendAndWait({ prompt: run.query }, 10 * 60 * 1000)
    const metrics = await run.session.rpc.usage.getMetrics()
    run.status = 'completed'
    publish(run, 'run.completed', {
      answer: answer?.data.content ?? '',
      metrics,
    })
  } catch (error) {
    run.status = run.status === 'cancelling' ? 'cancelled' : 'failed'
    publish(run, `run.${run.status}`, {
      message: error instanceof Error ? error.message : String(error),
    })
  } finally {
    if (run.session) await run.session.disconnect().catch(console.error)
    if (run.client) await run.client.stop().catch(console.error)
    for (const response of run.subscribers) response.end()
    run.subscribers.clear()
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? host}`)

  if (request.method === 'GET' && url.pathname === '/api/health') {
    sendJson(response, 200, { status: 'ok' })
    return
  }

  if (request.method === 'POST' && url.pathname === '/api/runs') {
    try {
      const body = await readJson(request)
      const query = typeof body.query === 'string' ? body.query.trim() : ''
      const repositoryPath = typeof body.repositoryPath === 'string'
        ? path.resolve(body.repositoryPath.trim())
        : ''
      if (!query) {
        sendJson(response, 400, { error: 'A query is required.' })
        return
      }
      if (!repositoryPath || !(await stat(repositoryPath)).isDirectory()) {
        sendJson(response, 400, { error: 'Repository path must be an existing directory.' })
        return
      }

      const run = {
        id: `run_${randomUUID().slice(0, 8)}`,
        query,
        repositoryPath,
        model: typeof body.model === 'string' ? body.model.trim() : '',
        status: 'starting',
        events: [],
        subscribers: new Set(),
        client: null,
        session: null,
      }
      runs.set(run.id, run)
      sendJson(response, 202, { runId: run.id })
      void executeRun(run)
    } catch (error) {
      sendJson(response, 400, {
        error: error instanceof Error ? error.message : 'Invalid request.',
      })
    }
    return
  }

  const eventMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/events$/)
  if (request.method === 'GET' && eventMatch) {
    const run = runs.get(eventMatch[1])
    if (!run) {
      sendJson(response, 404, { error: 'Run not found.' })
      return
    }
    response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    response.write('retry: 1000\n\n')
    for (const event of run.events) {
      response.write(`id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`)
    }
    if (['completed', 'failed', 'cancelled'].includes(run.status)) {
      response.end()
      return
    }
    run.subscribers.add(response)
    request.on('close', () => run.subscribers.delete(response))
    return
  }

  const cancelMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/cancel$/)
  if (request.method === 'POST' && cancelMatch) {
    const run = runs.get(cancelMatch[1])
    if (!run) {
      sendJson(response, 404, { error: 'Run not found.' })
      return
    }
    if (!run.session || !['starting', 'running'].includes(run.status)) {
      sendJson(response, 409, { error: 'Run is not active.' })
      return
    }
    run.status = 'cancelling'
    await run.session.abort()
    sendJson(response, 202, { status: 'cancelling' })
    return
  }

  sendJson(response, 404, { error: 'Not found.' })
})

server.listen(port, host, () => {
  console.log(`Traceflow API listening on http://${host}:${port}`)
})

async function shutdown() {
  server.close()
  await Promise.all([...runs.values()].map(async (run) => {
    if (run.session && run.status === 'running') await run.session.abort().catch(console.error)
    if (run.client) await run.client.stop().catch(console.error)
  }))
}

process.once('SIGINT', () => void shutdown())
process.once('SIGTERM', () => void shutdown())
