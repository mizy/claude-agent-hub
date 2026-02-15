import { useState, useEffect } from 'react'
import { marked } from 'marked'
import { useStore } from '../store/useStore'
import { extractNodeOutputText } from '../utils/extractNodeOutput'

const STATUS_COLORS: Record<string, string> = {
  pending: '#6b7280', ready: '#6b7280', running: '#3b82f6', waiting: '#3b82f6',
  done: '#22c55e', failed: '#ef4444', skipped: '#eab308',
}

const TASK_STATUS_COLORS: Record<string, string> = {
  pending: '#6b7280', developing: '#3b82f6', planning: '#3b82f6',
  reviewing: '#eab308', completed: '#22c55e', failed: '#ef4444',
  cancelled: '#6b7280', stopped: '#92400e', paused: '#f59e0b',
}

function fmtDur(ms: number) { return ms < 1000 ? `${ms}ms` : ms < 60000 ? `${(ms / 1000).toFixed(1)}s` : `${(ms / 60000).toFixed(1)}m` }

function NodeOutputMarkdown({ output }: { output: unknown }) {
  const [html, setHtml] = useState('')
  useEffect(() => {
    const text = extractNodeOutputText(output)
    marked.parse(text).then(setHtml).catch(() => setHtml(text))
  }, [output])
  if (!html) return <div className="output-box">Loading...</div>
  return <div className="markdown-body" dangerouslySetInnerHTML={{ __html: html }} />
}

function TaskInfoSection() {
  const taskData = useStore((s) => s.taskData)
  const pauseTask = useStore((s) => s.pauseTask)
  const resumeTask = useStore((s) => s.resumeTask)
  const stopTask = useStore((s) => s.stopTask)
  const setShowMessageModal = useStore((s) => s.setShowMessageModal)
  const setShowInjectNodeModal = useStore((s) => s.setShowInjectNodeModal)

  if (!taskData) return null
  const { task } = taskData
  const isRunning = ['developing', 'planning', 'reviewing'].includes(task.status)
  const isPaused = task.status === 'paused'
  const canResume = ['failed', 'cancelled', 'paused'].includes(task.status)

  return (
    <>
      <div className="panel-section">
        <div className="panel-section-title">Task Info</div>
        <div className="info-grid">
          <div className="info-item">
            <div className="label">Status</div>
            <div className="value" style={{ color: TASK_STATUS_COLORS[task.status] || '#6b7280' }}>{task.status}</div>
          </div>
          <div className="info-item">
            <div className="label">Priority</div>
            <div className="value">{task.priority}</div>
          </div>
          <div className="info-item">
            <div className="label">Created</div>
            <div className="value">{new Date(task.createdAt).toLocaleString('zh-CN', { hour12: false })}</div>
          </div>
          <div className="info-item">
            <div className="label">ID</div>
            <div className="value" style={{ fontSize: 10 }}>{task.id}</div>
          </div>
        </div>
      </div>

      {task.description && (
        <div className="panel-section">
          <div className="panel-section-title">Description</div>
          <div className="output-box" style={{ maxHeight: 120 }}>{task.description}</div>
        </div>
      )}

      <div className="panel-section">
        <div className="panel-section-title">Actions</div>
        <div className="task-detail-actions">
          {isRunning && (
            <button className="action-btn warning" onClick={() => pauseTask(task.id)}>Pause</button>
          )}
          {isRunning && (
            <button className="action-btn danger" onClick={() => stopTask(task.id)}>Stop</button>
          )}
          {(canResume || isPaused) && (
            <button className="action-btn primary" onClick={() => resumeTask(task.id)}>Resume</button>
          )}
          {isRunning && (
            <button className="action-btn" onClick={() => setShowMessageModal(task.id)}>Send Message</button>
          )}
          {isRunning && (
            <button className="action-btn" onClick={() => setShowInjectNodeModal(task.id)}>Inject Node</button>
          )}
        </div>
      </div>
    </>
  )
}

export function DetailsTab() {
  const taskData = useStore((s) => s.taskData)
  const selectedNodeId = useStore((s) => s.selectedNodeId)

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

    return (
      <div className="details-tab">
        <div className="panel-section">
          <div className="panel-section-title">Node: {node?.name || selectedNodeId}</div>
          <div className="info-grid">
            <div className="info-item">
              <div className="label">Status</div>
              <div className="value" style={{ color: STATUS_COLORS[state.status] || '#6b7280' }}>{state.status}</div>
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
          </div>
        </div>

        {state.error && (
          <div className="panel-section">
            <div className="panel-section-title">Error</div>
            <div className="error-box">{state.error}</div>
          </div>
        )}

        {output != null && (
          <div className="panel-section">
            <div className="panel-section-title">Output</div>
            <NodeOutputMarkdown output={output} />
          </div>
        )}
      </div>
    )
  }

  // Summary view
  const counts = { pending: 0, running: 0, done: 0, failed: 0, skipped: 0 } as Record<string, number>
  Object.values(nodeStates).forEach(s => { if (counts[s.status] !== undefined) counts[s.status]++ })

  const failedNodes = Object.entries(nodeStates).filter(([, s]) => s.status === 'failed')

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
                <div className="value" style={{ color: '#22c55e' }}>{counts.done}</div>
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
            <div className="panel-section">
              <div className="panel-section-title">Variables</div>
              <div className="output-box">{JSON.stringify(taskData.instance.variables, null, 2)}</div>
            </div>
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
