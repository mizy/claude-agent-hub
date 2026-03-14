/**
 * Statistics system type definitions
 */

// ============ Chat Stats ============

export interface HourDistribution {
  hour: number // 0-23
  count: number
}

export interface WeekdayDistribution {
  day: number // 0=Sunday, 6=Saturday
  count: number
}

export interface ChannelStats {
  platform: string
  messageCount: number
  percentage: number
}

export interface ChatStats {
  totalMessages: number
  inbound: number // user messages (dir=in)
  outbound: number // AI responses (dir=out)
  events: number // dir=event
  commands: number // dir=cmd
  sessionCount: number // unique sessionIds
  activeDays: number
  activeWeeks: number
  activeMonths: number
  avgResponseMs: number // average AI response time
  hourDistribution: HourDistribution[]
  weekdayDistribution: WeekdayDistribution[]
  avgUserMessageLength: number
  avgAiMessageLength: number
  channelDistribution: ChannelStats[]
  longestStreak: number // consecutive days with activity
  currentStreak: number
  totalCostUsd: number
}

// ============ Task Stats ============

export interface WeeklySuccessRate {
  week: string // ISO week label e.g. "2026-W10"
  total: number
  succeeded: number
  rate: number // 0-1
}

export interface TaskStats {
  total: number
  completed: number
  failed: number
  cancelled: number
  pending: number
  other: number // paused, planning, developing, reviewing, waiting
  successRate: number // completed / (completed + failed)
  weeklySuccessRates: WeeklySuccessRate[]
  avgDurationMs: number
  topBackends: { name: string; count: number }[]
  topModels: { name: string; count: number }[]
  topAgents: { name: string; count: number }[]
  avgNodeCount: number
  peakHours: HourDistribution[]
}

// ============ Lifecycle Stats ============

export interface LifecycleStats {
  startCount: number
  totalUptimeMs: number
  longestUptimeMs: number
  currentUptimeMs: number
  isRunning: boolean
  lastStartedAt?: string
  versionHistory: { version: string; timestamp: string }[]
}

// ============ Growth Stats ============

export interface GrowthMilestone {
  label: string
  achievedAt: string // ISO timestamp
  value: number
}

export interface GrowthJournalSummary {
  totalEntries: number
  byType: Record<string, number>
  recentMilestones: { date: string; milestone: string }[]
  weeklyCount: number
  monthlyCount: number
}

export interface GrowthStats {
  birthDate: string // first message timestamp
  ageDays: number
  activeDays: number
  milestones: GrowthMilestone[]
  totalMemories: number
  journal: GrowthJournalSummary
}

// ============ Project Milestones ============

export type { Milestone as ProjectMilestone } from '../milestones/generateMilestones.js'

import type { Milestone } from '../milestones/generateMilestones.js'

// ============ Overview ============

export interface StatsOverview {
  chat: ChatStats
  task: TaskStats
  lifecycle: LifecycleStats
  growth: GrowthStats
  projectMilestones: Milestone[]
  generatedAt: string
}

// ============ Cache ============

export interface StatsCache {
  data: StatsOverview
  cachedAt: number // Date.now()
  ttlMs: number
}
