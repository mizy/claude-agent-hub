export interface AgentTraits {
  codeStyle: 'minimal' | 'abstract' | 'strict' | 'modern'
  commentLevel: 'sparse' | 'moderate' | 'detailed' | 'comprehensive'
  errorHandling: 'essential' | 'standard' | 'comprehensive' | 'exhaustive'
  namingConvention: 'concise' | 'descriptive' | 'explicit'
}

export interface AgentPreferences {
  preferAbstraction: boolean
  preferPatterns: boolean
  preferDocumentation: boolean
}

export interface AgentConfig {
  name: string
  description: string
  traits: AgentTraits
  preferences: AgentPreferences
  systemPrompt: string
  /** Preferred model tier for this agent (e.g. 'sonnet' for tool-heavy agents) */
  preferredModel?: string
}
