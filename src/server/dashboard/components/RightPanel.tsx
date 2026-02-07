import { useStore } from '../store/useStore'
import { DetailsTab } from './DetailsTab'
import { TimelineTab } from './TimelineTab'
import { LogsTab } from './LogsTab'
import { OutputTab } from './OutputTab'

const TABS = [
  { key: 'details', label: 'Details' },
  { key: 'timeline', label: 'Timeline' },
  { key: 'logs', label: 'Logs' },
  { key: 'output', label: 'Output' },
] as const

export function RightPanel() {
  const activeTab = useStore((s) => s.activeTab)
  const setActiveTab = useStore((s) => s.setActiveTab)
  const taskData = useStore((s) => s.taskData)

  if (!taskData) return null

  return (
    <aside className="right-panel" id="right-panel">
      <div className="panel-tabs">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            className={`panel-tab ${tab.key === activeTab ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="panel-content">
        {activeTab === 'details' && <DetailsTab />}
        {activeTab === 'timeline' && <TimelineTab />}
        {activeTab === 'logs' && <LogsTab />}
        {activeTab === 'output' && <OutputTab />}
      </div>
    </aside>
  )
}
