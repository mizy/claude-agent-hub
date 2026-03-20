import { useState, useEffect } from 'react'
import { fetchApi } from '../api/fetchApi'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from 'recharts'
import '../styles/statistics.css'

// Types matching StatsOverview from statistics/types.ts
interface HourDistribution { hour: number; count: number }
interface WeekdayDistribution { day: number; count: number }
interface ChannelStats { platform: string; messageCount: number; percentage: number }
interface WeeklySuccessRate { week: string; total: number; succeeded: number; rate: number }
interface GrowthMilestone { label: string; achievedAt: string; value: number }

interface ProjectMilestone {
  version: string
  dateRange: { from: string; to: string }
  title: string
  description: string
  keyChanges: string[]
  commitCount: number
}

interface ChatStats {
  totalMessages: number; inbound: number; outbound: number; events: number; commands: number
  sessionCount: number; activeDays: number; activeWeeks: number; activeMonths: number
  avgResponseMs: number; hourDistribution: HourDistribution[]; weekdayDistribution: WeekdayDistribution[]
  avgUserMessageLength: number; avgAiMessageLength: number; channelDistribution: ChannelStats[]
  longestStreak: number; currentStreak: number; totalCostUsd: number
}

interface TaskStats {
  total: number; completed: number; failed: number; cancelled: number; pending: number; other: number
  successRate: number; weeklySuccessRates: WeeklySuccessRate[]; avgDurationMs: number
  topBackends: { name: string; count: number }[]; topModels: { name: string; count: number }[]
  topAgents: { name: string; count: number }[]; avgNodeCount: number; peakHours: HourDistribution[]
}

interface LifecycleStats {
  startCount: number; totalUptimeMs: number; longestUptimeMs: number; currentUptimeMs: number
  isRunning: boolean; lastStartedAt?: string; versionHistory: { version: string; timestamp: string }[]
}

interface GrowthStats {
  birthDate: string; genesisDate: string; ageDays: number; activeDays: number
  milestones: GrowthMilestone[]; totalMemories: number
}

interface StatsOverview {
  chat: ChatStats; task: TaskStats; lifecycle: LifecycleStats; growth: GrowthStats
  projectMilestones: ProjectMilestone[]; generatedAt: string
}

const COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#14b8a6']
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

interface DistributionDatum {
  label: string
  value: number
}

function formatDuration(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`
  const hours = Math.floor(ms / 3_600_000)
  const mins = Math.round((ms % 3_600_000) / 60_000)
  if (hours < 24) return `${hours}h ${mins}m`
  const days = Math.floor(hours / 24)
  return `${days}d ${hours % 24}h`
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })
}

// Build 30-day message trend from hour distribution + weekday distribution
// Since we don't have daily data, we'll use weeklySuccessRates for the line chart
function buildWeeklyTrend(rates: WeeklySuccessRate[]) {
  return rates.map(r => ({
    week: r.week,
    total: r.total,
    succeeded: r.succeeded,
    rate: Math.round(r.rate * 100),
  }))
}

// Build heatmap data: 7 days × 24 hours
function buildHeatmap(hourDist: HourDistribution[], weekdayDist: WeekdayDistribution[]) {
  // Create a simple 7×24 grid. Since we only have marginal distributions,
  // approximate joint distribution as product of marginals
  const totalH = hourDist.reduce((s, h) => s + h.count, 0) || 1
  const totalW = weekdayDist.reduce((s, w) => s + w.count, 0) || 1
  const grid: number[][] = []
  let maxVal = 0

  for (let day = 0; day < 7; day++) {
    const row: number[] = []
    const dayCount = weekdayDist.find(w => w.day === day)?.count ?? 0
    for (let hour = 0; hour < 24; hour++) {
      const hourCount = hourDist.find(h => h.hour === hour)?.count ?? 0
      const val = Math.round((dayCount / totalW) * (hourCount / totalH) * totalH)
      row.push(val)
      if (val > maxVal) maxVal = val
    }
    grid.push(row)
  }
  return { grid, maxVal }
}

function getHeatColor(val: number, max: number): string {
  if (max === 0 || val === 0) return 'var(--bg-primary)'
  const intensity = val / max
  if (intensity < 0.25) return 'rgba(59,130,246,0.15)'
  if (intensity < 0.5) return 'rgba(59,130,246,0.35)'
  if (intensity < 0.75) return 'rgba(59,130,246,0.55)'
  return 'rgba(59,130,246,0.8)'
}

function DistributionCard({ title, data }: { title: string; data: DistributionDatum[] }) {
  if (data.length === 0) {
    return (
      <div className="stats-pie-container">
        <div className="stats-pie-title">{title}</div>
        <div className="stats-chart-empty">No data</div>
      </div>
    )
  }

  const total = data.reduce((sum, item) => sum + item.value, 0)

  return (
    <div className="stats-pie-container">
      <div className="stats-pie-title">{title}</div>
      <div className="stats-pie-chart">
        <ResponsiveContainer width="100%" height={180}>
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="label"
              cx="50%"
              cy="44%"
              outerRadius={54}
              innerRadius={28}
              paddingAngle={2}
              stroke="var(--bg-secondary)"
              strokeWidth={2}
            >
              {data.map((_, i) => (
                <Cell key={i} fill={COLORS[i % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)', borderRadius: 8, fontSize: 12 }}
              formatter={(value: unknown) => Number(value).toLocaleString()}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="stats-distribution-list">
        {data.map((item, i) => (
          <div key={item.label} className="stats-distribution-item">
            <div className="stats-distribution-main">
              <span className="stats-distribution-dot" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
              <span className="stats-distribution-name">{item.label}</span>
            </div>
            <div className="stats-distribution-values">
              <span>{item.value.toLocaleString()}</span>
              <span>{total > 0 ? `${Math.round((item.value / total) * 100)}%` : '0%'}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function StatisticsPage() {
  const [stats, setStats] = useState<StatsOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchApi<StatsOverview>('/api/stats').then(data => {
      if (data) {
        setStats(data)
      } else {
        setError('Failed to load statistics')
      }
      setLoading(false)
    })
  }, [])

  if (loading) {
    return (
      <div className="stats-page">
        <div className="stats-header"><h2>Statistics</h2></div>
        <div className="stats-loading">
          <div className="stats-loading-spinner" />
          <span>Loading statistics...</span>
        </div>
      </div>
    )
  }

  if (error || !stats) {
    return (
      <div className="stats-page">
        <div className="stats-header"><h2>Statistics</h2></div>
        <div className="stats-loading">
          <span>{error ?? 'No data available'}</span>
        </div>
      </div>
    )
  }

  const { chat, task, lifecycle, growth, projectMilestones } = stats
  const weeklyTrend = buildWeeklyTrend(task.weeklySuccessRates)
  const { grid: heatmap, maxVal: heatMax } = buildHeatmap(chat.hourDistribution, chat.weekdayDistribution)
  const channelData = chat.channelDistribution.map((item) => ({
    label: item.platform,
    value: item.messageCount,
  }))
  const backendData = task.topBackends.map((item) => ({
    label: item.name,
    value: item.count,
  }))

  return (
    <div className="stats-page">
      <div className="stats-header">
        <div className="stats-header-left">
          <h2>Statistics</h2>
          <span className="stats-header-desc">
            Generated {new Date(stats.generatedAt).toLocaleString('zh-CN')}
          </span>
        </div>
      </div>

      <div className="stats-body">
        {/* Key Metrics Cards */}
        <div className="stats-cards">
          <div className="stats-card">
            <div className="stats-card-icon">💬</div>
            <div className="stats-card-content">
              <div className="stats-card-value">{chat.totalMessages.toLocaleString()}</div>
              <div className="stats-card-label">Messages</div>
              <div className="stats-card-sub">↑{chat.inbound} ↓{chat.outbound}</div>
            </div>
          </div>

          <div className="stats-card">
            <div className="stats-card-icon">📋</div>
            <div className="stats-card-content">
              <div className="stats-card-value">{task.total}</div>
              <div className="stats-card-label">Tasks</div>
              <div className="stats-card-sub">{Math.round(task.successRate * 100)}% success</div>
            </div>
          </div>

          <div className="stats-card">
            <div className="stats-card-icon">⏱</div>
            <div className="stats-card-content">
              <div className="stats-card-value">{formatDuration(lifecycle.totalUptimeMs)}</div>
              <div className="stats-card-label">Total Uptime</div>
              <div className="stats-card-sub">{lifecycle.startCount} restarts</div>
            </div>
          </div>

          <div className="stats-card">
            <div className="stats-card-icon">📅</div>
            <div className="stats-card-content">
              <div className="stats-card-value">{growth.ageDays}</div>
              <div className="stats-card-label">Days Alive</div>
              <div className="stats-card-sub">{growth.activeDays} active</div>
            </div>
          </div>

          <div className="stats-card">
            <div className="stats-card-icon">🔥</div>
            <div className="stats-card-content">
              <div className="stats-card-value">{chat.currentStreak}</div>
              <div className="stats-card-label">Current Streak</div>
              <div className="stats-card-sub">Best: {chat.longestStreak}d</div>
            </div>
          </div>

          <div className="stats-card">
            <div className="stats-card-icon">🧠</div>
            <div className="stats-card-content">
              <div className="stats-card-value">{growth.totalMemories}</div>
              <div className="stats-card-label">Memories</div>
              <div className="stats-card-sub">{chat.sessionCount} sessions</div>
            </div>
          </div>
        </div>

        {/* Charts Row */}
        <div className="stats-charts-row">
          {/* Weekly Task Trend */}
          <div className="stats-chart-card">
            <h3>Weekly Task Trend</h3>
            <div className="stats-chart-container">
              {weeklyTrend.length > 0 ? (
                <ResponsiveContainer width="100%" height={240}>
                  <LineChart data={weeklyTrend}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border-primary)" />
                    <XAxis dataKey="week" tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} />
                    <YAxis tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} />
                    <Tooltip
                      contentStyle={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)', borderRadius: 8, fontSize: 12 }}
                      labelStyle={{ color: 'var(--text-primary)' }}
                    />
                    <Line type="monotone" dataKey="total" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} name="Total" />
                    <Line type="monotone" dataKey="succeeded" stroke="#22c55e" strokeWidth={2} dot={{ r: 3 }} name="Succeeded" />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="stats-chart-empty">No data yet</div>
              )}
            </div>
          </div>

          {/* Pie Charts */}
          <div className="stats-chart-card">
            <h3>Distribution</h3>
            <div className="stats-pie-row">
              <DistributionCard title="Channels" data={channelData} />
              <DistributionCard title="Backends" data={backendData} />
            </div>
          </div>
        </div>

        {/* Activity Heatmap */}
        <div className="stats-chart-card">
          <h3>Activity Heatmap</h3>
          <div className="stats-heatmap">
            <div className="stats-heatmap-header">
              <div className="stats-heatmap-corner" />
              {Array.from({ length: 24 }, (_, h) => (
                <div key={h} className="stats-heatmap-hour">{h}</div>
              ))}
            </div>
            {heatmap.map((row, dayIdx) => (
              <div key={dayIdx} className="stats-heatmap-row">
                <div className="stats-heatmap-day">{DAY_NAMES[dayIdx]}</div>
                {row.map((val, hourIdx) => (
                  <div
                    key={hourIdx}
                    className="stats-heatmap-cell"
                    style={{ backgroundColor: getHeatColor(val, heatMax) }}
                    title={`${DAY_NAMES[dayIdx]} ${hourIdx}:00 — ${val} messages`}
                  />
                ))}
              </div>
            ))}
            <div className="stats-heatmap-legend">
              <span>Less</span>
              <div className="stats-heatmap-cell" style={{ backgroundColor: 'rgba(59,130,246,0.15)' }} />
              <div className="stats-heatmap-cell" style={{ backgroundColor: 'rgba(59,130,246,0.35)' }} />
              <div className="stats-heatmap-cell" style={{ backgroundColor: 'rgba(59,130,246,0.55)' }} />
              <div className="stats-heatmap-cell" style={{ backgroundColor: 'rgba(59,130,246,0.8)' }} />
              <span>More</span>
            </div>
          </div>
        </div>

        {/* Project Milestones Timeline */}
        <div className="stats-chart-card">
          <h3>Project Milestones</h3>
          <div className="stats-milestone-timeline">
            {lifecycle.isRunning && (
              <div className="stats-ms-item">
                <div className="stats-ms-marker">
                  <div className="stats-ms-dot running" />
                  <div className="stats-ms-line" />
                </div>
                <div className="stats-ms-card">
                  <div className="stats-ms-header">
                    <span className="stats-ms-version running">LIVE</span>
                    <span className="stats-ms-date">Uptime: {formatDuration(lifecycle.currentUptimeMs)}</span>
                  </div>
                  <div className="stats-ms-title">🟢 Running Now</div>
                </div>
              </div>
            )}
            {(() => {
              // Build unified timeline: version milestones + BORN + GENESIS, sorted by date desc
              type TimelineItem = { type: 'version'; data: ProjectMilestone; sortDate: string }
                | { type: 'born'; sortDate: string }
                | { type: 'genesis'; sortDate: string }
              const items: TimelineItem[] = projectMilestones.map(m => ({
                type: 'version' as const, data: m, sortDate: m.dateRange.to,
              }))
              if (growth.birthDate) items.push({ type: 'born', sortDate: growth.birthDate })
              if (growth.genesisDate) items.push({ type: 'genesis', sortDate: growth.genesisDate })
              items.sort((a, b) => b.sortDate.localeCompare(a.sortDate))
              return items.map((item, i) => {
                if (item.type === 'version') {
                  const m = item.data
                  return (
                    <div key={i} className="stats-ms-item">
                      <div className="stats-ms-marker">
                        <div className="stats-ms-dot" />
                        <div className="stats-ms-line" />
                      </div>
                      <div className="stats-ms-card">
                        <div className="stats-ms-header">
                          <span className="stats-ms-version">{m.version}</span>
                          <span className="stats-ms-date">
                            {formatDate(m.dateRange.from)}{m.dateRange.from !== m.dateRange.to ? ` — ${formatDate(m.dateRange.to)}` : ''}
                          </span>
                          <span className="stats-ms-commits">{m.commitCount} commits</span>
                        </div>
                        <div className="stats-ms-title">{m.title}</div>
                        <div className="stats-ms-desc">{m.description}</div>
                        {m.keyChanges.length > 0 && (
                          <div className="stats-ms-changes">
                            {m.keyChanges.map((change, j) => (
                              <span key={j} className="stats-ms-change-tag">{change}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )
                }
                if (item.type === 'born') {
                  return (
                    <div key={i} className="stats-ms-item">
                      <div className="stats-ms-marker">
                        <div className="stats-ms-dot birth" />
                        <div className="stats-ms-line" />
                      </div>
                      <div className="stats-ms-card">
                        <div className="stats-ms-header">
                          <span className="stats-ms-version birth">BORN</span>
                          <span className="stats-ms-date">{formatDate(growth.birthDate)}</span>
                        </div>
                        <div className="stats-ms-title">🎂 First Message — Digital Life Begins</div>
                      </div>
                    </div>
                  )
                }
                // genesis
                return (
                  <div key={i} className="stats-ms-item">
                    <div className="stats-ms-marker">
                      <div className="stats-ms-dot" style={{ background: 'var(--color-text-muted, #555)', opacity: 0.5 }} />
                    </div>
                    <div className="stats-ms-card" style={{ opacity: 0.6 }}>
                      <div className="stats-ms-header">
                        <span className="stats-ms-version" style={{ background: '#333', color: '#888' }}>GENESIS</span>
                        <span className="stats-ms-date">{formatDate(growth.genesisDate)}</span>
                      </div>
                      <div className="stats-ms-title">🧬 Project Created — Incubation Period</div>
                    </div>
                  </div>
                )
              })
            })()}
          </div>
        </div>

        {/* Growth Achievements */}
        {growth.milestones.length > 0 && (
          <div className="stats-chart-card">
            <h3>Growth Achievements</h3>
            <div className="stats-timeline">
              {growth.milestones.map((m, i) => (
                <div key={i} className="stats-timeline-item">
                  <div className="stats-timeline-dot" />
                  <div className="stats-timeline-content">
                    <div className="stats-timeline-label">{m.label}</div>
                    <div className="stats-timeline-date">{formatDate(m.achievedAt)}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
