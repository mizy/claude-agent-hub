export interface PlanStep {
  order: number
  action: string
  files: string[]
}

export interface Plan {
  id: string
  analysis: string
  files: string[]
  steps: PlanStep[]
  risks: string[]
  estimatedEffort: 'small' | 'medium' | 'large'
  createdAt: string
}
