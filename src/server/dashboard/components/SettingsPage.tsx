import { useState, useEffect, useCallback } from 'react'
import { fetchApi, putApi } from '../api/fetchApi'
import { useStore } from '../store/useStore'

interface BackendEntry {
  type: string
  model: string
  max_tokens?: number
  enableAgentTeams?: boolean
}

interface ConfigData {
  defaultBackend: string
  backends: Record<string, BackendEntry>
  tasks: { default_priority: string; max_retries: number; timeout: string }
  git: { base_branch: string; branch_prefix: string; auto_push: boolean }
  notify?: {
    lark?: { appId: string; appSecret: string; webhookUrl?: string; chatId?: string }
    telegram?: { botToken: string; chatId?: string }
  }
}

type SectionId = 'general' | 'backends' | 'tasks' | 'git' | 'lark' | 'telegram'

const SVG_PROPS = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const } as const

const EyeIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
)
const EyeOffIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24" /><line x1="1" y1="1" x2="23" y2="23" /></svg>
)

function SectionIcon({ id }: { id: SectionId }) {
  const props = SVG_PROPS
  switch (id) {
    case 'general': return <svg {...props}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>
    case 'backends': return <svg {...props}><rect x="2" y="2" width="20" height="8" rx="2" ry="2"/><rect x="2" y="14" width="20" height="8" rx="2" ry="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>
    case 'tasks': return <svg {...props}><path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg>
    case 'git': return <svg {...props}><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M13 6h3a2 2 0 012 2v7"/><line x1="6" y1="9" x2="6" y2="21"/></svg>
    case 'lark': return <svg {...props}><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
    case 'telegram': return <svg {...props}><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
  }
}

const SECTIONS: { id: SectionId; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'backends', label: 'Backends' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'git', label: 'Git' },
  { id: 'lark', label: 'Lark' },
  { id: 'telegram', label: 'Telegram' },
]

export function SettingsPage() {
  const addToast = useStore((s) => s.addToast)
  const [config, setConfig] = useState<ConfigData | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [activeSection, setActiveSection] = useState<SectionId>('general')
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({})

  const loadSettings = useCallback(async () => {
    const data = await fetchApi<ConfigData>('/api/config')
    if (data) setConfig(data)
  }, [])

  useEffect(() => { loadSettings() }, [loadSettings])

  if (!config) return (
    <div className="settings-page">
      <div className="settings-loading">
        <div className="settings-loading-spinner" />
        <span>Loading settings...</span>
      </div>
    </div>
  )

  const update = <K extends keyof ConfigData>(key: K, value: ConfigData[K]) => {
    setConfig({ ...config, [key]: value })
    setDirty(true)
  }

  const updateNested = (path: string, value: unknown) => {
    const keys = path.split('.')
    const next = { ...config } as Record<string, unknown>
    let cursor = next
    for (let i = 0; i < keys.length - 1; i++) {
      const k = keys[i]
      cursor[k] = { ...(cursor[k] as Record<string, unknown> || {}) }
      cursor = cursor[k] as Record<string, unknown>
    }
    cursor[keys[keys.length - 1]] = value
    setConfig(next as unknown as ConfigData)
    setDirty(true)
  }

  const handleSave = async () => {
    setSaving(true)
    const res = await putApi<{ success: boolean }>('/api/config', config)
    setSaving(false)
    if (res) {
      setDirty(false)
      addToast('Settings saved', 'success')
    } else {
      addToast('Failed to save settings', 'error')
    }
  }

  const toggleSecret = (key: string) => {
    setShowSecrets((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  const backendKeys = Object.keys(config.backends)

  const scrollToSection = (id: SectionId) => {
    setActiveSection(id)
    const el = document.getElementById(`settings-section-${id}`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="settings-page">
      <div className="settings-header">
        <div className="settings-header-left">
          <h2>Settings</h2>
          <span className="settings-header-desc">Configure your agent hub</span>
        </div>
        <button
          className="settings-save-btn"
          disabled={!dirty || saving}
          onClick={handleSave}
        >
          {saving ? (
            <>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M12 2v4m0 12v4m-7.07-3.93l2.83-2.83m8.48-8.48l2.83-2.83M2 12h4m12 0h4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83" className="settings-spinner-path" />
              </svg>
              Saving...
            </>
          ) : (
            <>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z" />
                <polyline points="17 21 17 13 7 13 7 21" />
                <polyline points="7 3 7 8 15 8" />
              </svg>
              Save Changes
            </>
          )}
        </button>
      </div>

      <div className="settings-body">
        {/* Side nav */}
        <nav className="settings-nav">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              className={`settings-nav-item ${activeSection === s.id ? 'active' : ''}`}
              onClick={() => scrollToSection(s.id)}
            >
              <span className="settings-nav-icon"><SectionIcon id={s.id} /></span>
              <span>{s.label}</span>
            </button>
          ))}
        </nav>

        {/* Content */}
        <div className="settings-content">
          {/* General */}
          <section id="settings-section-general" className="settings-section">
            <div className="settings-section-header">
              <h3>General</h3>
              <p>Basic configuration for your agent hub</p>
            </div>
            <div className="settings-card">
              <div className="settings-field">
                <label>Default Backend</label>
                <p className="settings-field-desc">Backend used when no specific backend is requested</p>
                <select
                  value={config.defaultBackend}
                  onChange={(e) => update('defaultBackend', e.target.value)}
                >
                  {backendKeys.map((k) => <option key={k} value={k}>{k}</option>)}
                </select>
              </div>
            </div>
          </section>

          {/* Backends */}
          <section id="settings-section-backends" className="settings-section">
            <div className="settings-section-header">
              <h3>Backends</h3>
              <p>Configure AI backend providers and their models</p>
            </div>
            {backendKeys.map((key) => {
              const b = config.backends[key]
              const isDefault = key === config.defaultBackend
              return (
                <div key={key} className="settings-card">
                  <div className="settings-card-title">
                    <span className="settings-backend-dot" />
                    <span>{key}</span>
                    {isDefault && <span className="settings-badge">Default</span>}
                  </div>
                  <div className="settings-field-row">
                    <div className="settings-field">
                      <label>Type</label>
                      <select
                        value={b.type}
                        onChange={(e) => {
                          const backends = { ...config.backends, [key]: { ...b, type: e.target.value } }
                          update('backends', backends)
                        }}
                      >
                        {['claude-code', 'opencode', 'iflow', 'codebuddy', 'cursor', 'openai-compatible'].map((t) => (
                          <option key={t} value={t}>{t}</option>
                        ))}
                      </select>
                    </div>
                    <div className="settings-field">
                      <label>Model</label>
                      <input
                        type="text"
                        value={b.model}
                        placeholder="e.g. claude-sonnet-4-20250514"
                        onChange={(e) => {
                          const backends = { ...config.backends, [key]: { ...b, model: e.target.value } }
                          update('backends', backends)
                        }}
                      />
                    </div>
                  </div>
                </div>
              )
            })}
          </section>

          {/* Tasks */}
          <section id="settings-section-tasks" className="settings-section">
            <div className="settings-section-header">
              <h3>Task Defaults</h3>
              <p>Default settings for new tasks</p>
            </div>
            <div className="settings-card">
              <div className="settings-field-row">
                <div className="settings-field">
                  <label>Priority</label>
                  <select
                    value={config.tasks.default_priority}
                    onChange={(e) => updateNested('tasks.default_priority', e.target.value)}
                  >
                    {['low', 'medium', 'high'].map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <div className="settings-field">
                  <label>Max Retries</label>
                  <input
                    type="number"
                    value={config.tasks.max_retries}
                    onChange={(e) => updateNested('tasks.max_retries', parseInt(e.target.value) || 0)}
                  />
                </div>
                <div className="settings-field">
                  <label>Timeout</label>
                  <p className="settings-field-desc">e.g. 30m, 1h, 2h</p>
                  <input
                    type="text"
                    value={config.tasks.timeout}
                    placeholder="30m"
                    onChange={(e) => updateNested('tasks.timeout', e.target.value)}
                  />
                </div>
              </div>
            </div>
          </section>

          {/* Git */}
          <section id="settings-section-git" className="settings-section">
            <div className="settings-section-header">
              <h3>Git</h3>
              <p>Version control integration settings</p>
            </div>
            <div className="settings-card">
              <div className="settings-field-row">
                <div className="settings-field">
                  <label>Base Branch</label>
                  <input
                    type="text"
                    value={config.git.base_branch}
                    placeholder="main"
                    onChange={(e) => updateNested('git.base_branch', e.target.value)}
                  />
                </div>
                <div className="settings-field">
                  <label>Branch Prefix</label>
                  <input
                    type="text"
                    value={config.git.branch_prefix}
                    placeholder="cah/"
                    onChange={(e) => updateNested('git.branch_prefix', e.target.value)}
                  />
                </div>
              </div>
              <div className="settings-field settings-field-spaced">
                <label>Auto Push</label>
                <p className="settings-field-desc">Automatically push changes after task completion</p>
                <div className="settings-toggle-wrap">
                  <button
                    className={`settings-toggle ${config.git.auto_push ? 'on' : ''}`}
                    onClick={() => updateNested('git.auto_push', !config.git.auto_push)}
                  >
                    <span className="settings-toggle-knob" />
                  </button>
                  <span className="settings-toggle-label">{config.git.auto_push ? 'Enabled' : 'Disabled'}</span>
                </div>
              </div>
            </div>
          </section>

          {/* Lark */}
          <section id="settings-section-lark" className="settings-section">
            <div className="settings-section-header">
              <h3>Lark Notification</h3>
              <p>Send task notifications via Lark / Feishu</p>
            </div>
            <div className="settings-card">
              <div className="settings-field-row">
                <div className="settings-field">
                  <label>App ID</label>
                  <input
                    type="text"
                    value={config.notify?.lark?.appId || ''}
                    placeholder="cli_xxxxx"
                    onChange={(e) => updateNested('notify.lark.appId', e.target.value)}
                  />
                </div>
                <div className="settings-field">
                  <label>App Secret</label>
                  <div className="settings-secret-wrap">
                    <input
                      type={showSecrets['larkSecret'] ? 'text' : 'password'}
                      value={config.notify?.lark?.appSecret || ''}
                      onChange={(e) => updateNested('notify.lark.appSecret', e.target.value)}
                    />
                    <button className="settings-secret-toggle" onClick={() => toggleSecret('larkSecret')} title={showSecrets['larkSecret'] ? 'Hide' : 'Show'}>
                      {showSecrets['larkSecret'] ? <EyeOffIcon /> : <EyeIcon />}
                    </button>
                  </div>
                </div>
              </div>
              <div className="settings-field settings-field-spaced">
                <label>Webhook URL</label>
                <input
                  type="text"
                  value={config.notify?.lark?.webhookUrl || ''}
                  placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/..."
                  onChange={(e) => updateNested('notify.lark.webhookUrl', e.target.value)}
                />
              </div>
            </div>
          </section>

          {/* Telegram */}
          <section id="settings-section-telegram" className="settings-section">
            <div className="settings-section-header">
              <h3>Telegram Notification</h3>
              <p>Send task notifications via Telegram bot</p>
            </div>
            <div className="settings-card">
              <div className="settings-field-row">
                <div className="settings-field">
                  <label>Bot Token</label>
                  <div className="settings-secret-wrap">
                    <input
                      type={showSecrets['tgToken'] ? 'text' : 'password'}
                      value={config.notify?.telegram?.botToken || ''}
                      onChange={(e) => updateNested('notify.telegram.botToken', e.target.value)}
                    />
                    <button className="settings-secret-toggle" onClick={() => toggleSecret('tgToken')} title={showSecrets['tgToken'] ? 'Hide' : 'Show'}>
                      {showSecrets['tgToken'] ? <EyeOffIcon /> : <EyeIcon />}
                    </button>
                  </div>
                </div>
                <div className="settings-field">
                  <label>Chat ID</label>
                  <input
                    type="text"
                    value={config.notify?.telegram?.chatId || ''}
                    placeholder="e.g. -100123456789"
                    onChange={(e) => updateNested('notify.telegram.chatId', e.target.value)}
                  />
                </div>
              </div>
            </div>
          </section>

          {/* Bottom spacer for sticky save button */}
          <div style={{ height: 80 }} />
        </div>
      </div>

      {/* Sticky bottom save bar */}
      {dirty && (
        <div className="settings-sticky-save">
          <span>You have unsaved changes</span>
          <button
            className="settings-save-btn"
            disabled={saving}
            onClick={handleSave}
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      )}
    </div>
  )
}
