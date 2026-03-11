import { useState, useEffect } from 'react'
import { marked } from 'marked'
import { useStore } from '../store/useStore'
import { extractNodeOutputText } from '../utils/extractNodeOutput'

const STATUS_COLORS: Record<string, string> = {
  pending: '#6b7280', ready: '#6b7280', running: '#3b82f6', waiting: '#3b82f6',
  done: '#22c55e', completed: '#22c55e', failed: '#ef4444', skipped: '#eab308',
  stopped: '#eab308', cancelled: '#eab308', 'loop-completed': '#a78bfa',
}

const TASK_STATUS_COLORS: Record<string, string> = {
  pending: '#6b7280', developing: '#3b82f6', planning: '#3b82f6',
  reviewing: '#eab308', completed: '#22c55e', failed: '#ef4444',
  cancelled: '#6b7280', stopped: '#92400e', paused: '#f59e0b', waiting: '#3b82f6',
}

function fmtDur(ms: number) { return ms < 1000 ? `${ms}ms` : ms < 60000 ? `${(ms / 1000).toFixed(1)}s` : `${(ms / 60000).toFixed(1)}m` }

function normalizeNodeStatus(status: string): 'pending' | 'running' | 'completed' | 'failed' | 'skipped' {
  if (status === 'ready') return 'pending'
  if (status === 'waiting') return 'running'
  if (status === 'done' || status === 'completed') return 'completed'
  if (status === 'failed') return 'failed'
  if (status === 'skipped' || status === 'stopped' || status === 'cancelled') return 'skipped'
  return 'pending'
}

function NodeOutputMarkdown({ output }: { output: unknown }) {
  const [html, setHtml] = useState('')
  useEffect(() => {
    const text = extractNodeOutputText(output)
    try {
      const result = marked.parse(text)
      if (result instanceof Promise) {
        result.then(setHtml).catch(() => setHtml(text))
      } else {
        setHtml(result)
      }
    } catch { setHtml(text) }
  }, [output])
  if (!html) return <div className="output-box">Loading...</div>
  return (
    <div className="output-box output-markdown">
      <div className="markdown-body" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  )
}

function TaskInfoSection() {
  const taskData = useStore((s) => s.taskData)
  const pauseTask = useStore((s) => s.pauseTask)
  const resumeTask = useStore((s) => s.resumeTask)
  const stopTask = useStore((s) => s.stopTask)
  const completeTask = useStore((s) => s.completeTask)
  const setShowMessageModal = useStore((s) => s.setShowMessageModal)
  const setShowInjectNodeModal = useStore((s) => s.setShowInjectNodeModal)
  const deleteTask = useStore((s) => s.deleteTask)
  const createTask = useStore((s) => s.createTask)

  if (!taskData) return null
  const { task } = taskData
  const isRunning = ['planning', 'developing'].includes(task.status)
  const isPausable = task.status === 'developing'
  const isStoppable = ['pending', 'planning', 'developing', 'paused', 'reviewing', 'waiting'].includes(task.status)
  const canResume = ['failed', 'cancelled', 'stopped', 'paused'].includes(task.status)
  const isTerminal = ['completed', 'failed', 'cancelled', 'stopped'].includes(task.status)
  const hasActions = isPausable || isStoppable || canResume || task.status === 'reviewing' || isRunning || isTerminal

  return (
    <>
      <div className="panel-section">
        <div className="panel-section-title">Task Info</div>
        <div className="info-grid">
          <div className="info-item">
            <div className="label">Status</div>
            <div className="value">
              <span className="status-badge" style={{ color: TASK_STATUS_COLORS[task.status] || '#6b7280', background: `${TASK_STATUS_COLORS[task.status] || '#6b7280'}20` }}>{task.status}</span>
            </div>
          </div>
          <div className="info-item">
            <div className="label">Priority</div>
            <div className="value">{task.priority}</div>
          </div>
          <div className="info-item">
            <div className="label">Created</div>
            <div className="value">{new Date(task.createdAt).toLocaleString('zh-CN', { hour12: false })}</div>
          </div>
          <div className="info-item full">
            <div className="label">ID</div>
            <div className="value">{task.id}</div>
          </div>
          {task.backend && (
            <div className="info-item">
              <div className="label">Backend</div>
              <div className="value">{task.backend}</div>
            </div>
          )}
          {task.model && (
            <div className="info-item">
              <div className="label">Model</div>
              <div className="value">{task.model}</div>
            </div>
          )}
          {task.source && (
            <div className="info-item">
              <div className="label">Source</div>
              <div className="value">{task.source}</div>
            </div>
          )}
          {task.scheduleCron && (
            <div className="info-item">
              <div className="label">Schedule</div>
              <div className="value" style={{ color: '#818cf8' }}>{task.scheduleCron}</div>
            </div>
          )}
        </div>
      </div>

      {task.description && (
        <div className="panel-section">
          <div className="panel-section-title">Description</div>
          <div className="output-box" style={{ maxHeight: 180 }}>{task.description}</div>
        </div>
      )}

      {hasActions && (
        <div className="panel-section">
          <div className="panel-section-title">Actions</div>
          <div className="task-detail-actions">
            {isPausable && (
              <button className="action-btn warning" onClick={() => pauseTask(task.id)}>Pause</button>
            )}
            {isStoppable && (
              <button className="action-btn danger" onClick={() => stopTask(task.id)}>Stop</button>
            )}
            {canResume && (
              <button className="action-btn primary" onClick={() => resumeTask(task.id)}>Resume</button>
            )}
            {task.status === 'reviewing' && (
              <button className="action-btn success" onClick={() => completeTask(task.id)}>Complete</button>
            )}
            {isRunning && (
              <button className="action-btn" onClick={() => setShowMessageModal(task.id)}>Send Message</button>
            )}
            {isRunning && (
              <button className="action-btn" onClick={() => setShowInjectNodeModal(task.id)}>Inject Node</button>
            )}
            {isTerminal && (
              <button className="action-btn primary" onClick={() => createTask(task.description || task.title)}>Re-run</button>
            )}
            {isTerminal && (
              <button className="action-btn danger" onClick={() => deleteTask(task.id)}>Delete</button>
            )}
          </div>
        </div>
      )}
    </>
  )
}

function VariablesSection({ variables }: { variables: Record<string, unknown> }) {
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set())
  const toggle = (key: string) => setExpandedKeys(prev => {
    const next = new Set(prev)
    next.has(key) ? next.delete(key) : next.add(key)
    return next
  })

  // Separate simple (string/number/boolean) vs complex (object/array) values
  const simple: [string, string][] = []
  const complex: [string, unknown][] = []
  for (const [k, v] of Object.entries(variables)) {
    if (v === null || v === undefined) simple.push([k, String(v)])
    else if (typeof v === 'object') complex.push([k, v])
    else simple.push([k, String(v)])
  }

  return (
    <div className="panel-section">
      <div className="panel-section-title">Variables</div>
      {simple.length > 0 && (
        <div className="info-grid">
          {simple.map(([k, v]) => (
            <div key={k} className={`info-item${v.length > 30 ? ' full' : ''}`}>
              <div className="label">{k}</div>
              <div className="value">{v}</div>
            </div>
          ))}
        </div>
      )}
      {complex.map(([k, v]) => (
        <div key={k} className="var-complex-item">
          <button className="var-complex-toggle" onClick={() => toggle(k)}>
            <span>{expandedKeys.has(k) ? '▾' : '▸'}</span> {k}
          </button>
          {expandedKeys.has(k) && (
            <div className="output-box" style={{ marginTop: 4 }}>
              <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {JSON.stringify(v, null, 2)}
              </pre>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

export function DetailsTab() {
  const taskData = useStore((s) => s.taskData)
  const selectedNodeId = useStore((s) => s.selectedNodeId)
  const selectNode = useStore((s) => s.selectNode)
  const setActiveTab = useStore((s) => s.setActiveTab)

  if (!taskData) {
    return <div className="empty-state">No execution data</div>
  }

  const nodeStates = taskData.instance?.nodeStates || {}
  const outputs = taskData.instance?.outputs || {}
  const nodes = taskData.workflow?.nodes || []

  // Selected node detail view
  if (selectedNodeId && nodeStates[selectedNodeId]) {
    const state = nodeStates[selectedNodeId]
    const node = nodes.find(n => n.id === selectedNodeId)
    const output = outputs[selectedNodeId]
    const displayStatus = normalizeNodeStatus(state.status)

    return (
      <div className="details-tab">
        <div className="panel-section">
          <div className="panel-section-title node-detail-title">
            <button className="action-btn node-back-btn" onClick={() => selectNode(null)}>&larr; Back</button>
            <span className="node-detail-label">Node</span>
            <span className="node-detail-name">{node?.name || selectedNodeId}</span>
          </div>
          <div className="info-grid">
            <div className="info-item">
              <div className="label">Status</div>
              <div className="value">
                <span className="status-badge" style={{ color: STATUS_COLORS[displayStatus] || '#6b7280', background: `${STATUS_COLORS[displayStatus] || '#6b7280'}20` }}>{state.status}</span>
              </div>
            </div>
            <div className="info-item">
              <div className="label">Type</div>
              <div className="value">{node?.type || '-'}</div>
            </div>
            <div className="info-item">
              <div className="label">Attempts</div>
              <div className="value">{state.attempts}</div>
            </div>
            <div className="info-item">
              <div className="label">Duration</div>
              <div className="value">{state.durationMs ? fmtDur(state.durationMs) : '-'}</div>
            </div>
            {node?.task?.agent && (
              <div className="info-item full">
                <div className="label">Agent</div>
                <div className="value">{node.task.agent}</div>
              </div>
            )}
            {(node?.task?.backend || node?.config?.backend) && (
              <div className="info-item">
                <div className="label">Backend</div>
                <div className="value">{node.task?.backend || node.config?.backend}</div>
              </div>
            )}
            {(node?.task?.model || node?.config?.model) && (
              <div className="info-item">
                <div className="label">Model</div>
                <div className="value">{node.task?.model || node.config?.model}</div>
              </div>
            )}
          </div>
        </div>

        {node?.description && node.description !== node.name && (
          <div className="panel-section">
            <div className="panel-section-title">Description</div>
            <div className="output-box">{node.description}</div>
          </div>
        )}

        {node?.task?.prompt && (
          <div className="panel-section">
            <div className="panel-section-title">Prompt</div>
            <div className="output-box" style={{ maxHeight: 300 }}>
              <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{node.task.prompt}</pre>
            </div>
          </div>
        )}

        {state.error && (
          <div className="panel-section">
            <div className="panel-section-title">Error</div>
            <div className="error-box">{state.error}</div>
          </div>
        )}

        {output != null && (
          <div className="panel-section">
            <div className="panel-section-title">Output</div>
            <NodeOutputMarkdown key={selectedNodeId} output={output} />
          </div>
        )}

        {node?.type === 'task' && (
          <div className="panel-section">
            <button className="action-btn" onClick={() => setActiveTab('logs')}>View Node Logs</button>
          </div>
        )}
      </div>
    )
  }

  // Summary view
  const counts = { pending: 0, running: 0, completed: 0, failed: 0, skipped: 0 }
  Object.values(nodeStates).forEach(s => { counts[normalizeNodeStatus(s.status)]++ })

  const failedNodes = Object.entries(nodeStates).filter(([, s]) => normalizeNodeStatus(s.status) === 'failed')

  return (
    <div className="details-tab">
      <TaskInfoSection />

      {taskData.instance && (
        <>
          <div className="panel-section">
            <div className="panel-section-title">Workflow Summary</div>
            <div className="info-grid">
              <div className="info-item">
                <div className="label">Total Nodes</div>
                <div className="value">{nodes.length}</div>
              </div>
              <div className="info-item">
                <div className="label">Completed</div>
                <div className="value" style={{ color: '#22c55e' }}>{counts.completed}</div>
              </div>
              <div className="info-item">
                <div className="label">Running</div>
                <div className="value" style={{ color: '#3b82f6' }}>{counts.running}</div>
              </div>
              <div className="info-item">
                <div className="label">Failed</div>
                <div className="value" style={{ color: '#ef4444' }}>{counts.failed}</div>
              </div>
            </div>
          </div>

          {taskData.instance.variables && Object.keys(taskData.instance.variables).length > 0 && (
            <VariablesSection variables={taskData.instance.variables} />
          )}

          {failedNodes.length > 0 && (
            <div className="panel-section">
              <div className="panel-section-title">Failed Nodes</div>
              {failedNodes.map(([nodeId, state]) => {
                const node = nodes.find(n => n.id === nodeId)
                return (
                  <div key={nodeId} className="error-box" style={{ marginBottom: 8 }}>
                    <strong>{node?.name || nodeId}</strong><br />
                    {state.error || 'Unknown error'}
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}
