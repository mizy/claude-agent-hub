import { useState, useEffect, useRef } from 'react'
import { marked } from 'marked'
import { useStore } from '../store/useStore'
import { fetchApi } from '../api/fetchApi'
import { extractNodeOutputText } from '../utils/extractNodeOutput'

export function OutputTab() {
  const selectedTaskId = useStore((s) => s.selectedTaskId)
  const taskData = useStore((s) => s.taskData)
  const [resultHtml, setResultHtml] = useState('')
  const [nodeHtmls, setNodeHtmls] = useState<Record<string, string>>({})
  const lastTaskId = useRef<string | null>(null)
  const hasResult = useRef(false)

  // Re-fetch result.md on task change and on each poll update
  useEffect(() => {
    if (!selectedTaskId) return

    // Reset on task switch
    if (lastTaskId.current !== selectedTaskId) {
      lastTaskId.current = selectedTaskId
      hasResult.current = false
      setResultHtml('')
      setNodeHtmls({})
    }

    // If we already have result.md, refresh it
    // If not, check if it appeared (task may have completed)
    fetchApi<{ content: string }>(`/api/tasks/${selectedTaskId}/result`).then(async (res) => {
      if (res?.content) {
        hasResult.current = true
        setResultHtml(await marked.parse(res.content))
      }
    }).catch(() => { /* result.md may not exist yet */ })
  }, [selectedTaskId, taskData])

  // Parse node outputs as markdown when in fallback mode
  useEffect(() => {
    if (hasResult.current || !taskData?.instance?.outputs) return

    const outputs = taskData.instance.outputs
    const entries = Object.entries(outputs)
    if (entries.length === 0) return

    Promise.all(
      entries.map(async ([nodeId, output]) => {
        const text = extractNodeOutputText(output)
        const html = await marked.parse(text)
        return [nodeId, html] as const
      })
    ).then((results) => {
      const map: Record<string, string> = {}
      for (const [nodeId, html] of results) map[nodeId] = html
      setNodeHtmls(map)
    }).catch(() => { /* markdown parse error */ })
  }, [taskData?.instance?.outputs])

  if (!selectedTaskId) return <div className="empty-state">Select a task to view output</div>

  // Rendered markdown from result.md
  if (resultHtml) return <div className="markdown-body" dangerouslySetInnerHTML={{ __html: resultHtml }} />

  // Fallback: show node outputs as rendered markdown
  if (taskData?.instance?.outputs) {
    const outputs = taskData.instance.outputs
    const nodes = taskData.workflow?.nodes || []
    const entries = Object.entries(outputs)

    if (entries.length === 0) return <div className="empty-state">No outputs yet</div>

    return (
      <div>
        {entries.map(([nodeId]) => {
          const node = nodes.find(n => n.id === nodeId)
          const html = nodeHtmls[nodeId]
          return (
            <div key={nodeId} className="panel-section">
              <div className="panel-section-title">{node?.name || nodeId}</div>
              {html
                ? <div className="markdown-body" dangerouslySetInnerHTML={{ __html: html }} />
                : <div className="output-box">Loading...</div>
              }
            </div>
          )
        })}
      </div>
    )
  }

  return <div className="empty-state">No output available</div>
}
