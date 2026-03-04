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

export function SettingsPage() {
  const addToast = useStore((s) => s.addToast)
  const [config, setConfig] = useState<ConfigData | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)

  const loadSettings = useCallback(async () => {
    const data = await fetchApi<ConfigData>('/api/config')
    if (data) setConfig(data)
  }, [])

  useEffect(() => { loadSettings() }, [loadSettings])

  if (!config) return <div className="settings-page"><div className="settings-loading">Loading...</div></div>

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

  const backendKeys = Object.keys(config.backends)

  return (
    <div className="settings-page">
      <div className="settings-header">
        <h2>Settings</h2>
        <button
          className={`modal-btn submit ${dirty ? '' : 'disabled'}`}
          disabled={!dirty || saving}
          onClick={handleSave}
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>

      <div className="settings-content">
        {/* Default Backend */}
        <div className="settings-card">
          <h3>Default Backend</h3>
          <div className="settings-field">
            <label>Backend</label>
            <select
              value={config.defaultBackend}
              onChange={(e) => update('defaultBackend', e.target.value)}
            >
              {backendKeys.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
          </div>
        </div>

        {/* Backends */}
        <div className="settings-card">
          <h3>Backends</h3>
          {backendKeys.map((key) => {
            const b = config.backends[key]
            return (
              <div key={key} className="settings-backend-item">
                <div className="settings-backend-name">{key}</div>
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
                      {['claude-code', 'opencode', 'iflow', 'codebuddy'].map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  </div>
                  <div className="settings-field">
                    <label>Model</label>
                    <input
                      type="text"
                      value={b.model}
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
        </div>

        {/* Task Defaults */}
        <div className="settings-card">
          <h3>Task Defaults</h3>
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
              <input
                type="text"
                value={config.tasks.timeout}
                onChange={(e) => updateNested('tasks.timeout', e.target.value)}
              />
            </div>
          </div>
        </div>

        {/* Git */}
        <div className="settings-card">
          <h3>Git</h3>
          <div className="settings-field-row">
            <div className="settings-field">
              <label>Base Branch</label>
              <input
                type="text"
                value={config.git.base_branch}
                onChange={(e) => updateNested('git.base_branch', e.target.value)}
              />
            </div>
            <div className="settings-field">
              <label>Branch Prefix</label>
              <input
                type="text"
                value={config.git.branch_prefix}
                onChange={(e) => updateNested('git.branch_prefix', e.target.value)}
              />
            </div>
            <div className="settings-field">
              <label>Auto Push</label>
              <div className="settings-toggle-wrap">
                <button
                  className={`settings-toggle ${config.git.auto_push ? 'on' : ''}`}
                  onClick={() => updateNested('git.auto_push', !config.git.auto_push)}
                >
                  <span className="settings-toggle-knob" />
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Notify - Lark */}
        <div className="settings-card">
          <h3>Notify - Lark</h3>
          <div className="settings-field-row">
            <div className="settings-field">
              <label>App ID</label>
              <input
                type="text"
                value={config.notify?.lark?.appId || ''}
                onChange={(e) => updateNested('notify.lark.appId', e.target.value)}
              />
            </div>
            <div className="settings-field">
              <label>App Secret</label>
              <input
                type="password"
                value={config.notify?.lark?.appSecret || ''}
                onChange={(e) => updateNested('notify.lark.appSecret', e.target.value)}
              />
            </div>
          </div>
          <div className="settings-field">
            <label>Webhook URL</label>
            <input
              type="text"
              value={config.notify?.lark?.webhookUrl || ''}
              onChange={(e) => updateNested('notify.lark.webhookUrl', e.target.value)}
            />
          </div>
        </div>

        {/* Notify - Telegram */}
        <div className="settings-card">
          <h3>Notify - Telegram</h3>
          <div className="settings-field-row">
            <div className="settings-field">
              <label>Bot Token</label>
              <input
                type="password"
                value={config.notify?.telegram?.botToken || ''}
                onChange={(e) => updateNested('notify.telegram.botToken', e.target.value)}
              />
            </div>
            <div className="settings-field">
              <label>Chat ID</label>
              <input
                type="text"
                value={config.notify?.telegram?.chatId || ''}
                onChange={(e) => updateNested('notify.telegram.chatId', e.target.value)}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
