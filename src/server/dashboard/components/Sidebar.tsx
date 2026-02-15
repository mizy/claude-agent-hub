import { useState } from 'react'
import { useStore, Task } from '../store/useStore'

function ActionButtons({ task }: { task: Task }) {
  const stopTask = useStore((s) => s.stopTask)
  const resumeTask = useStore((s) => s.resumeTask)
  const completeTask = useStore((s) => s.completeTask)
  const setPendingDeleteTask = useStore((s) => s.setPendingDeleteTask)
  const s = task.status

  return (
    <div className="task-actions">
      {['developing', 'planning', 'reviewing'].includes(s) && (
        <button className="action-btn warning" onClick={(e) => { e.stopPropagation(); stopTask(task.id) }}>Stop</button>
      )}
      {['failed', 'cancelled', 'paused'].includes(s) && (
        <button className="action-btn primary" onClick={(e) => { e.stopPropagation(); resumeTask(task.id) }}>Resume</button>
      )}
      {s === 'reviewing' && (
        <button className="action-btn success" onClick={(e) => { e.stopPropagation(); completeTask(task.id) }}>Complete</button>
      )}
      <button className="action-btn danger" onClick={(e) => { e.stopPropagation(); setPendingDeleteTask({ id: task.id, title: task.title }) }}>Delete</button>
    </div>
  )
}

export function Sidebar() {
  const tasks = useStore((s) => s.tasks)
  const selectedTaskId = useStore((s) => s.selectedTaskId)
  const selectTask = useStore((s) => s.selectTask)
  const setShowNewTaskModal = useStore((s) => s.setShowNewTaskModal)

  return (
    <aside className="sidebar" id="sidebar">
      <div className="sidebar-header">
        <div>
          <h1>CAH Workflow</h1>
          <div className="subtitle">Claude Agent Hub Visualizer</div>
        </div>
        <button className="new-task-btn" onClick={() => setShowNewTaskModal(true)}>+ New Task</button>
      </div>
      <div className="task-list">
        {tasks.map((task) => (
          <div
            key={task.id}
            className={`task-item ${task.id === selectedTaskId ? 'active' : ''}`}
            onClick={() => selectTask(task.id)}
          >
            <div className="task-title">{task.title}</div>
            <div className="task-meta">
              <span className={`task-status status-${task.status}`}>{task.status}</span>
              <span>{new Date(task.createdAt).toLocaleString('zh-CN', { hour12: false })}</span>
            </div>
            <ActionButtons task={task} />
          </div>
        ))}
      </div>
    </aside>
  )
}

export function NewTaskModal() {
  const show = useStore((s) => s.showNewTaskModal)
  const setShow = useStore((s) => s.setShowNewTaskModal)
  const createTask = useStore((s) => s.createTask)
  const [desc, setDesc] = useState('')
  const [loading, setLoading] = useState(false)

  if (!show) return null

  const onSubmit = async () => {
    if (!desc.trim()) return
    setLoading(true)
    const ok = await createTask(desc.trim())
    setLoading(false)
    if (ok) { setDesc(''); setShow(false) }
  }

  return (
    <div className="modal-overlay visible" onClick={(e) => { if (e.target === e.currentTarget) setShow(false) }}>
      <div className="modal">
        <h3>New Task</h3>
        <textarea
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          placeholder="Describe what you want the agent to do..."
          onKeyDown={(e) => { if (e.key === 'Enter' && e.metaKey) onSubmit() }}
          autoFocus
        />
        <div className="modal-actions">
          <button className="modal-btn cancel" onClick={() => setShow(false)}>Cancel</button>
          <button className="modal-btn submit" onClick={onSubmit} disabled={loading}>
            {loading ? 'Creating...' : 'Create & Run'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function DeleteConfirmModal() {
  const pending = useStore((s) => s.pendingDeleteTask)
  const setPending = useStore((s) => s.setPendingDeleteTask)
  const deleteTask = useStore((s) => s.deleteTask)
  const [loading, setLoading] = useState(false)

  if (!pending) return null

  const onDelete = async () => {
    setLoading(true)
    await deleteTask(pending.id)
    setLoading(false)
    setPending(null)
  }

  return (
    <div className="modal-overlay visible" onClick={(e) => { if (e.target === e.currentTarget) setPending(null) }}>
      <div className="modal">
        <h3>Delete Task</h3>
        <p style={{ fontSize: 13, color: '#94a3b8', marginBottom: 8 }}>Are you sure you want to delete this task? This cannot be undone.</p>
        <p style={{ fontSize: 13, fontWeight: 500 }}>{pending.title}</p>
        <div className="modal-actions">
          <button className="modal-btn cancel" onClick={() => setPending(null)}>Cancel</button>
          <button className="modal-btn submit" style={{ background: '#ef4444' }} onClick={onDelete} disabled={loading}>
            {loading ? 'Deleting...' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  )
}
