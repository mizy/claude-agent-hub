/** External inspiration proposal collected from open-source community */
export interface Proposal {
  source: string
  title: string
  idea: string
  inspiration: string
  difficulty: 'low' | 'medium' | 'high'
  discoveredAt: string
  status: 'pending' | 'accepted' | 'rejected' | 'implemented'
}
