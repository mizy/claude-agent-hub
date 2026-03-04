import { useRef, useEffect, useCallback } from 'react'
import VEditor from 'mmeditor'
import { useStore } from '../store/useStore'
import { workflowToSchema } from './workflowToSchema'
import { workflowNodeShape, STATUS_COLORS, fmtDur } from './workflowNodeShape'

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

export function WorkflowCanvas() {
  const containerRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<VEditor | null>(null)
  const tipRef = useRef<HTMLDivElement>(null)
  const taskData = useStore((s) => s.taskData)
  const selectedNodeId = useStore((s) => s.selectedNodeId)
  const selectNode = useStore((s) => s.selectNode)
  const prevKeyRef = useRef<string | null>(null)
  const prevTaskIdRef = useRef<string | null>(null)
  const prevStateKeyRef = useRef<string | null>(null)

  // Initialize editor + tooltip + click handlers
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const editor = new VEditor({
      dom: el,
      mode: 'view',
      showBackGrid: false,
      showMiniMap: false,
      hideAchor: true,
    })
    editor.graph.node.registeNode('wf-node', workflowNodeShape)
    editorRef.current = editor

    // Node click → select
    editor.graph.on('node:click', ({ node }: { node: { data: { uuid: string } } }) => {
      selectNode(node.data.uuid)
    })
    // Paper click → deselect
    editor.graph.on('paper:click', () => {
      selectNode(null)
    })

    // Tooltip on hover
    const showTip = ({ node, event }: { node: { data: Record<string, unknown> }; event: MouseEvent }) => {
      const tip = tipRef.current
      const wrap = containerRef.current
      if (!tip || !wrap) return
      const d = node.data
      const status = (d.status as string) || 'pending'
      const rawColor = STATUS_COLORS[status]
      const color = rawColor && /^#[0-9a-fA-F]{3,8}$/.test(rawColor) ? rawColor : '#6b7280'
      tip.innerHTML = `<div style="font-weight:600;margin-bottom:4px">${esc(d.name as string || '')}</div>` +
        `<div style="color:#64748b">${esc(d.nodeType as string || '')}</div>` +
        `<div style="color:${color};margin-top:4px">${esc(status)}</div>` +
        (d.durationMs ? `<div style="color:#94a3b8">${fmtDur(d.durationMs as number)}</div>` : '') +
        (d.error ? `<div style="color:#ef4444;margin-top:4px;font-size:10px">${esc((d.error as string).slice(0, 100))}</div>` : '')
      tip.style.display = 'block'
      const cr = wrap.getBoundingClientRect()
      let tx = event.clientX - cr.left + 12, ty = event.clientY - cr.top + 12
      if (tx + 200 > cr.width) tx = event.clientX - cr.left - 200
      if (ty + 100 > cr.height) ty = event.clientY - cr.top - 100
      tip.style.left = tx + 'px'
      tip.style.top = ty + 'px'
    }
    const hideTip = () => {
      if (tipRef.current) tipRef.current.style.display = 'none'
    }
    editor.graph.on('node:mouseenter', showTip)
    editor.graph.on('node:mouseleave', hideTip)

    return () => {
      editor.destroy()
      editorRef.current = null
    }
  }, [selectNode])

  // Sync data
  useEffect(() => {
    const editor = editorRef.current
    if (!editor || !taskData?.workflow) return
    const { nodes, edges } = taskData.workflow
    const structKey = nodes.map(n => n.id).join(',') + '|' + (edges || []).map(e => e.from + '-' + e.to).join(',')
    const structureChanged = structKey !== prevKeyRef.current
    prevKeyRef.current = structKey

    const currentTaskId = taskData.task.id
    const taskChanged = currentTaskId !== prevTaskIdRef.current
    prevTaskIdRef.current = currentTaskId

    // Build a key from nodeStates to skip re-render when poll returns identical data
    const ns = taskData.instance?.nodeStates || {}
    const stateKey = Object.keys(ns).sort().map(k => `${k}:${ns[k].status}`).join(',')
    const stateChanged = stateKey !== prevStateKeyRef.current
    prevStateKeyRef.current = stateKey

    if (!structureChanged && !taskChanged && !stateChanged) return

    const taskDone = taskData.task.status === 'completed' || taskData.task.status === 'done'
    const schema = workflowToSchema(nodes, edges || [], taskData.instance, taskDone)
    editor.schema.setData(schema).then(() => {
      if (structureChanged || taskChanged) {
        requestAnimationFrame(() => {
          editor.controller.autoScale()
          editor.controller.autoFit()
        })
      }
    }).catch((e: unknown) => console.warn('[WorkflowCanvas] setData failed:', e))
  }, [taskData])

  // Highlight selected node
  useEffect(() => {
    const editor = editorRef.current
    if (!editor?.graph?.node?.nodes) return
    const allNodes = editor.graph.node.nodes
    for (const id in allNodes) {
      const dom = allNodes[id]?.dom
      if (dom) dom.classList.toggle('wf-selected', id === selectedNodeId)
    }
  }, [selectedNodeId])

  const fitView = useCallback(() => {
    const editor = editorRef.current
    if (!editor) return
    editor.controller.autoScale()
    editor.controller.autoFit()
  }, [])

  const hasWf = !!taskData?.workflow
  return (
    <div className="main">
      {hasWf && (
        <>
          <div className="main-header">
            <div><h2>{taskData!.task.title}</h2><div className="task-id-label">{taskData!.task.id}</div></div>
            <div className="header-actions"><button className="btn" onClick={fitView}>Fit View</button></div>
          </div>
          <div className="toolbar">
            <div className="legend">
              <div className="legend-item"><div className="legend-dot dot-pending" /> Pending</div>
              <div className="legend-item"><div className="legend-dot dot-running" /> Running</div>
              <div className="legend-item"><div className="legend-dot dot-done" /> Done</div>
              <div className="legend-item"><div className="legend-dot dot-failed" /> Failed</div>
              <div className="legend-item"><div className="legend-dot dot-skipped" /> Skipped</div>
            </div>
          </div>
        </>
      )}
      {!hasWf && taskData && (
        <div className="main-header"><div><h2>{taskData.task.title}</h2><div className="task-id-label">{taskData.task.id}</div></div></div>
      )}
      <div className="canvas-container" style={{ position: 'relative' }}>
        {!taskData && <div className="no-selection">Select a task to view workflow</div>}
        {taskData && !hasWf && <div className="no-selection">No workflow generated yet</div>}
        <div
          ref={containerRef}
          style={{ width: '100%', height: '100%', display: hasWf ? 'block' : 'none' }}
        />
        <div ref={tipRef} className="node-tooltip" style={{ display: 'none' }} />
      </div>
    </div>
  )
}
