import { useState, useEffect, useRef } from 'react'
import { marked } from 'marked'
import { useStore } from '../store/useStore'
import { fetchApi } from '../api/fetchApi'
import { extractNodeOutputText } from '../utils/extractNodeOutput'

export function OutputTab() {
  const selectedTaskId = useStore((s) => s.selectedTaskId)
  const selectedNodeId = useStore((s) => s.selectedNodeId)
  const selectNode = useStore((s) => s.selectNode)
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

  // Parse node outputs as markdown (always, so node-filter mode works even on completed tasks)
  useEffect(() => {
    if (!taskData?.instance?.outputs) return

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

  // Node selected: show only that node's output
  if (selectedNodeId && taskData?.instance?.outputs) {
    const outputs = taskData.instance.outputs
    const nodes = taskData.workflow?.nodes || []
    const entries = Object.entries(outputs).filter(([nodeId]) => nodeId === selectedNodeId)
    const nodeName = nodes.find(n => n.id === selectedNodeId)?.name ?? selectedNodeId

    return (
      <div>
        <div className="output-node-filter">
          Showing: {nodeName}
          {' '}<button className="btn logs-show-all-btn" onClick={() => selectNode(null)}>Show All</button>
        </div>
        {entries.length === 0
          ? <div className="empty-state">No output for this node yet</div>
          : entries.map(([nodeId]) => {
              const html = nodeHtmls[nodeId]
              return (
                <div key={nodeId} className="panel-section">
                  {html
                    ? <div className="markdown-body" dangerouslySetInnerHTML={{ __html: html }} />
                    : <div className="output-box">Loading...</div>
                  }
                </div>
              )
            })
        }
      </div>
    )
  }

  // No node selected: show final result.md if available
  if (resultHtml) return <div className="markdown-body" dangerouslySetInnerHTML={{ __html: resultHtml }} />

  // Fallback: show all node outputs
  if (taskData?.instance?.outputs) {
    const outputs = taskData.instance.outputs
    const nodes = taskData.workflow?.nodes || []
    const allEntries = Object.entries(outputs)
    if (allEntries.length === 0) return <div className="empty-state">No outputs yet</div>
    return (
      <div>
        {allEntries.map(([nodeId]) => {
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
