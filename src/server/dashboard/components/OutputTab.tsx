import { useState, useEffect } from 'react'
import { marked } from 'marked'
import { useStore } from '../store/useStore'
import { fetchApi } from '../api/fetchApi'

export function OutputTab() {
  const selectedTaskId = useStore((s) => s.selectedTaskId)
  const taskData = useStore((s) => s.taskData)
  const [html, setHtml] = useState('')
  const [fallback, setFallback] = useState(false)

  useEffect(() => {
    if (!selectedTaskId) return
    setHtml('')
    setFallback(false)

    // Try result.md first
    fetchApi<{ content: string }>(`/api/tasks/${selectedTaskId}/result`).then(async (res) => {
      if (res?.content) {
        setHtml(await marked.parse(res.content))
      } else {
        setFallback(true)
      }
    })
  }, [selectedTaskId])

  if (!selectedTaskId) return <div className="empty-state">Select a task to view output</div>

  // Rendered markdown from result.md
  if (html) return <div className="markdown-body" dangerouslySetInnerHTML={{ __html: html }} />

  // Fallback: show node outputs
  if (fallback && taskData?.instance?.outputs) {
    const outputs = taskData.instance.outputs
    const nodes = taskData.workflow?.nodes || []
    const entries = Object.entries(outputs)

    if (entries.length === 0) return <div className="empty-state">No outputs yet</div>

    return (
      <div>
        {entries.map(([nodeId, output]) => {
          const node = nodes.find(n => n.id === nodeId)
          return (
            <div key={nodeId} className="panel-section">
              <div className="panel-section-title">{node?.name || nodeId}</div>
              <div className="output-box">{typeof output === 'object' ? JSON.stringify(output, null, 2) : String(output)}</div>
            </div>
          )
        })}
      </div>
    )
  }

  return <div className="empty-state">No output available</div>
}
