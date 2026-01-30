export interface PersonaTraits {
  codeStyle: 'minimal' | 'abstract' | 'strict' | 'modern'
  commentLevel: 'sparse' | 'moderate' | 'detailed' | 'comprehensive'
  errorHandling: 'essential' | 'standard' | 'comprehensive' | 'exhaustive'
  namingConvention: 'concise' | 'descriptive' | 'explicit'
}

export interface PersonaPreferences {
  preferAbstraction: boolean
  preferPatterns: boolean
  preferDocumentation: boolean
}

export interface PersonaConfig {
  name: string
  description: string
  traits: PersonaTraits
  preferences: PersonaPreferences
  systemPrompt: string
}
