import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ConnState, PeerSwitchSettings } from '../../preload/index'

type Panel = 'none' | 'files' | 'settings'

type Transfer = {
  id: string
  name: string
  received: number
  size: number
  direction: 'in' | 'out'
  done?: boolean
  finishedAt?: number
}

function formatHotkey(hk: string): string {
  return hk.replace(/\+/g, ' + ')
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function IconSwitch({ active }: { active?: boolean }): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M7 8h11l-2.5-2.5M17 16H6l2.5 2.5" strokeLinecap="round" strokeLinejoin="round" />
      {active ? <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" /> : null}
    </svg>
  )
}

function IconFiles(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path
        d="M8 4h6l4 4v10a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"
        strokeLinejoin="round"
      />
      <path d="M14 4v4h4" strokeLinejoin="round" />
    </svg>
  )
}

function IconSettings(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="3" />
      <path
        d="M12 3.5v2.2M12 18.3v2.2M4.9 6.5l1.6 1.6M17.5 15.9l1.6 1.6M3.5 12h2.2M18.3 12h2.2M4.9 17.5l1.6-1.6M17.5 8.1l1.6-1.6"
        strokeLinecap="round"
      />
    </svg>
  )
}

export default function App(): JSX.Element {
  const [settings, setSettings] = useState<PeerSwitchSettings | null>(null)
  const [inputs, setInputs] = useState<{ label: string; value: string }[]>([])
  const [state, setState] = useState<ConnState>({ status: 'idle' })
  const [panel, setPanel] = useState<Panel>('none')
  const [hostIp, setHostIp] = useState('')
  const [busy, setBusy] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [scanProgress, setScanProgress] = useState('')
  const [lanHits, setLanHits] = useState<{ ip: string; port: number; ms: number }[]>([])
  const [log, setLog] = useState('')
  const [dropActive, setDropActive] = useState(false)
  const [transfers, setTransfers] = useState<Transfer[]>([])
  const [pendingOffer, setPendingOffer] = useState<{
    id: string
    name: string
    size: number
  } | null>(null)

  useEffect(() => {
    void (async () => {
      const s = await window.peerswitch.getSettings()
      setSettings(s)
      setHostIp(s.lastHost || '')
      setInputs(await window.peerswitch.commonInputs())
      setState(await window.peerswitch.getState())
    })()

    const offs = [
      window.peerswitch.on('conn-state', (p) => setState(p as ConnState)),
      window.peerswitch.on('log', (p) => setLog(String(p))),
      window.peerswitch.on('settings', (p) => setSettings(p as PeerSwitchSettings)),
      window.peerswitch.on('switch-result', (p) => {
        const r = p as { ok: boolean; detail: string }
        setLog(r.detail)
      }),
      window.peerswitch.on('file-progress', (p) => {
        const t = p as Transfer
        setTransfers((prev) => {
          const i = prev.findIndex((x) => x.id === t.id)
          if (i < 0) return [t, ...prev]
          const next = [...prev]
          next[i] = { ...next[i], ...t }
          return next
        })
      }),
      window.peerswitch.on('file-done', (p) => {
        const t = p as Transfer
        setTransfers((prev) =>
          prev.map((x) =>
            x.id === t.id
              ? { ...x, done: true, received: x.size, finishedAt: Date.now() }
              : x
          )
        )
      }),
      window.peerswitch.on('file-offer', (p) => {
        setPendingOffer(p as { id: string; name: string; size: number })
        setPanel('files')
      }),
      window.peerswitch.on('open-panel', (p) => {
        if (p === 'files' || p === 'settings') setPanel(p)
      }),
      window.peerswitch.on('lan-scan-progress', (p) => {
        const { done, total } = p as { done: number; total: number }
        setScanProgress(`扫描中 ${done}/${total}`)
      })
    ]
    return () => offs.forEach((off) => off())
  }, [])

  // 完成后约 3 秒自动移除，避免一直占着列表
  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now()
      setTransfers((prev) =>
        prev.filter((t) => !t.done || !t.finishedAt || now - t.finishedAt < 3000)
      )
    }, 500)
    return () => clearInterval(timer)
  }, [])

  const removeTransfer = (id: string): void => {
    setTransfers((prev) => prev.filter((t) => t.id !== id))
  }

  const clearTransfers = (): void => {
    setTransfers([])
  }

  const fileHotkeyLabel =
    typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform)
      ? '⌘ + ⌥ + F'
      : 'Ctrl + Alt + F'

  const saveSettings = useCallback(async (patch: Partial<PeerSwitchSettings>) => {
    const next = await window.peerswitch.updateSettings(patch)
    setSettings(next)
  }, [])

  const onJoin = async (ip?: string): Promise<void> => {
    const target = (ip || hostIp).trim()
    if (!target) {
      setLog('请填写主机 IP')
      return
    }
    setBusy(true)
    setHostIp(target)
    try {
      await window.peerswitch.join(target, '666666')
    } catch (e) {
      setLog(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const onScanLan = async (): Promise<void> => {
    setScanning(true)
    setScanProgress('扫描中…')
    setLanHits([])
    try {
      const hits = await window.peerswitch.scanLan()
      setLanHits(hits)
      setScanProgress(hits.length ? `发现 ${hits.length} 台` : '未发现主机')
      setLog(hits.length ? `发现 ${hits.length} 台` : '未发现主机')
    } catch (e) {
      setScanProgress('')
      setLog(e instanceof Error ? e.message : String(e))
    } finally {
      setScanning(false)
    }
  }

  const onSwitch = async (): Promise<void> => {
    setBusy(true)
    try {
      const r = await window.peerswitch.switchNow()
      setLog(r.detail)
    } finally {
      setBusy(false)
    }
  }

  const onSendFiles = async (): Promise<void> => {
    if (state.status !== 'connected') {
      setLog('请先连接对端')
      return
    }
    setPanel('files')
    try {
      await window.peerswitch.pickAndSendFiles()
    } catch (e) {
      setLog(e instanceof Error ? e.message : String(e))
    }
  }

  const sendDroppedFiles = async (fileList: FileList | File[]): Promise<void> => {
    const files = Array.from(fileList)
    const paths = files
      .map((f) => (f as File & { path?: string }).path)
      .filter((p): p is string => Boolean(p))
    if (!paths.length) {
      setLog('无法读取文件路径')
      return
    }
    if (state.status !== 'connected') {
      setLog('请先连接对端')
      return
    }
    setPanel('files')
    try {
      await window.peerswitch.sendFilePaths(paths)
      setLog(`正在发送 ${paths.length} 个文件…`)
    } catch (e) {
      setLog(e instanceof Error ? e.message : String(e))
    }
  }

  const statusLabel = useMemo(() => {
    if (state.status === 'connected') return `已连接：${state.peerName}`
    if (state.status === 'hosting') return '主机等待中（后台常驻）'
    if (state.status === 'connecting') return '正在连接…'
    return '未连接'
  }, [state])

  if (!settings) {
    return <div className="app" />
  }

  const connected = state.status === 'connected'

  return (
    <div
      className="app"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => e.preventDefault()}
    >
      <header className="titlebar">
        <div className="titlebar-brand">
          <div className="logo-mark" />
          <div className="brand-name">PeerSwitch</div>
        </div>
        <div className="titlebar-actions">
          <button
            className={`icon-btn ${connected ? 'active' : ''}`}
            title={`切换屏幕（${formatHotkey(settings.hotkey)}）`}
            onClick={() => void onSwitch()}
            disabled={busy}
          >
            <IconSwitch active={connected} />
          </button>

          <div
            className={`drop-zone ${dropActive ? 'active' : ''} ${connected ? 'ready' : ''} ${
              panel === 'files' ? 'open' : ''
            }`}
            title={
              connected
                ? `拖入或点击选择文件（${fileHotkeyLabel}）`
                : '连接对端后可拖入文件'
            }
            onDragEnter={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setDropActive(true)
            }}
            onDragOver={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setDropActive(true)
            }}
            onDragLeave={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setDropActive(false)
            }}
            onDrop={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setDropActive(false)
              void sendDroppedFiles(e.dataTransfer.files)
            }}
            onClick={() => void onSendFiles()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                void onSendFiles()
              }
            }}
          >
            <IconFiles />
            <div className="drop-zone-text">
              <strong>{dropActive ? '松开上传' : '拖入文件'}</strong>
              <span>{connected ? '发送到对端' : '先连接对端'}</span>
            </div>
          </div>

          <button
            className={`icon-btn ${panel === 'settings' ? 'active' : ''}`}
            title="设置"
            onClick={() => setPanel(panel === 'settings' ? 'none' : 'settings')}
          >
            <IconSettings />
          </button>
        </div>
      </header>

      <main className="content">
        <div className="panel-shell">
          {!connected ? (
            <div className="hero">
              <div className="eyebrow">PeerSwitch</div>
              <h1>一台显示器，两台电脑</h1>

              <div className="card join-card">
                <h2>加入对端</h2>
                {settings.pairId || settings.lastHost ? (
                  <div className="status-bar" style={{ marginBottom: 12 }}>
                    <div>
                      <span className="dot wait" />
                      {settings.lastPeerName
                        ? `正在连接 ${settings.lastPeerName}…`
                        : settings.lastHost
                          ? `正在重连 ${settings.lastHost}…`
                          : '正在寻找对端…'}
                    </div>
                    {settings.lastHost ? (
                      <button
                        className="btn btn-secondary"
                        onClick={() => void onJoin(settings.lastHost)}
                      >
                        立即重连
                      </button>
                    ) : null}
                  </div>
                ) : null}
                <button
                  className="btn btn-secondary"
                  disabled={busy || scanning}
                  onClick={() => void onScanLan()}
                  style={{ marginBottom: 12, width: '100%' }}
                >
                  {scanning ? scanProgress || '扫描中…' : '扫描局域网'}
                </button>
                {lanHits.length > 0 && (
                  <div className="lan-hit-list">
                    {lanHits.map((h) => (
                      <button
                        key={h.ip}
                        type="button"
                        className={`lan-hit ${hostIp === h.ip ? 'selected' : ''}`}
                        disabled={busy}
                        onClick={() => void onJoin(h.ip)}
                        title={`${h.ms} ms`}
                      >
                        <strong>{h.ip}</strong>
                        <span>{h.ms} ms</span>
                      </button>
                    ))}
                  </div>
                )}
                {!scanning && scanProgress && lanHits.length === 0 && (
                  <p className="muted" style={{ marginBottom: 12 }}>
                    {scanProgress}
                  </p>
                )}
                <div className="field">
                  <label>主机 IP</label>
                  <input
                    value={hostIp}
                    placeholder="192.168.x.x"
                    onChange={(e) => setHostIp(e.target.value)}
                  />
                </div>
                <button
                  className="btn btn-primary"
                  disabled={busy || !hostIp}
                  onClick={() => void onJoin()}
                >
                  加入
                </button>
              </div>

              <div className="status-bar">
                <div>
                  <span
                    className={`dot ${
                      state.status === 'hosting' || state.status === 'connecting' ? 'wait' : ''
                    }`}
                  />
                  {statusLabel}
                </div>
                {state.status !== 'idle' && (
                  <button
                    className="btn btn-secondary"
                    onClick={() => void window.peerswitch.disconnect()}
                  >
                    取消
                  </button>
                )}
              </div>
              <div className="log-line">{log}</div>
            </div>
          ) : (
            <div className="hero connected-hero">
              <div className="eyebrow">已连接</div>
              <h1>切换到 {state.peerName}</h1>

              <button className="switch-orb" onClick={() => void onSwitch()} disabled={busy}>
                <IconSwitch />
                <strong>切换</strong>
                <span>屏幕</span>
              </button>

              <p className="hotkey-hint">
                <kbd>{formatHotkey(settings.hotkey)}</kbd>
                {' · '}
                <kbd>{fileHotkeyLabel}</kbd>
              </p>

              <div className="status-bar" style={{ maxWidth: 520, margin: '28px auto 0' }}>
                <div>
                  <span className="dot on" />
                  {statusLabel}
                  {state.role === 'host' ? ' · 主机' : ' · 客户端'}
                </div>
                <button
                  className="btn btn-secondary"
                  onClick={() => void window.peerswitch.disconnect()}
                >
                  暂时断开
                </button>
                <button
                  className="btn btn-danger"
                  onClick={async () => {
                    const next = await window.peerswitch.forgetPairing()
                    setSettings(next)
                    setHostIp('')
                    setLog('已清除配对')
                  }}
                >
                  断开并忘记
                </button>
              </div>
              <div className="log-line">{log}</div>
            </div>
          )}
        </div>

        {panel === 'files' && (
          <aside className="side-drawer">
            <div className="drawer-head">
              <h2>传送文件</h2>
              <button className="icon-btn" title="关闭" onClick={() => setPanel('none')}>
                ✕
              </button>
            </div>
            <p className="muted">{connected ? '选择或拖入文件发送' : '未连接'}</p>
            <button
              className="btn btn-primary"
              disabled={!connected}
              onClick={() => void onSendFiles()}
            >
              选择文件发送
            </button>
            <button
              className="btn btn-secondary"
              onClick={() => void window.peerswitch.openDownloadDir()}
            >
              打开接收文件夹
            </button>

            {pendingOffer && (
              <div className="transfer-item">
                <div className="name">收到：{pendingOffer.name}</div>
                <div className="meta-row">
                  <span>{formatBytes(pendingOffer.size)}</span>
                  <span>
                    <button
                      className="btn btn-secondary"
                      style={{ height: 28, marginRight: 6 }}
                      onClick={() => {
                        void window.peerswitch.rejectFile(pendingOffer.id)
                        setPendingOffer(null)
                      }}
                    >
                      拒绝
                    </button>
                    <button
                      className="btn btn-primary"
                      style={{ height: 28 }}
                      onClick={() => {
                        void window.peerswitch.acceptFile(
                          pendingOffer.id,
                          pendingOffer.name,
                          pendingOffer.size
                        )
                        setPendingOffer(null)
                      }}
                    >
                      接受
                    </button>
                  </span>
                </div>
              </div>
            )}

            {transfers.length > 0 && (
              <>
                <div className="drawer-head" style={{ marginTop: 8 }}>
                  <p className="muted" style={{ margin: 0 }}>
                    当前传输
                  </p>
                  <button className="link-btn" onClick={clearTransfers}>
                    清空
                  </button>
                </div>
                <div className="transfer-list">
                  {transfers.map((t) => {
                    const pct = t.size ? Math.min(100, Math.round((t.received / t.size) * 100)) : 0
                    return (
                      <div className="transfer-item" key={t.id}>
                        <div className="name-row">
                          <div className="name">
                            {t.direction === 'out' ? '↑' : '↓'} {t.name}
                          </div>
                          <button
                            className="link-btn"
                            title="删除此条"
                            onClick={() => removeTransfer(t.id)}
                          >
                            删除
                          </button>
                        </div>
                        <div className="bar">
                          <i style={{ width: `${t.done ? 100 : pct}%` }} />
                        </div>
                        <div className="meta-row">
                          <span>
                            {formatBytes(t.received)} / {formatBytes(t.size)}
                          </span>
                          <span>{t.done ? '完成' : `${pct}%`}</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </>
            )}
          </aside>
        )}

        {panel === 'settings' && (
          <aside className="side-drawer">
            <h2>设置</h2>

            <div className="settings-grid">
              <div className="field">
                <label>本机名称</label>
                <input
                  value={settings.displayName}
                  onChange={(e) => setSettings({ ...settings, displayName: e.target.value })}
                  onBlur={() => void saveSettings({ displayName: settings.displayName })}
                />
              </div>

              <div className="field">
                <label>切换快捷键</label>
                <input
                  value={settings.hotkey}
                  onChange={(e) => setSettings({ ...settings, hotkey: e.target.value })}
                  onBlur={() => void saveSettings({ hotkey: settings.hotkey })}
                  placeholder="Command+Option+Q"
                />
              </div>

              <div className="field">
                <label>本机输入口</label>
                <select
                  value={settings.localInput}
                  onChange={(e) => {
                    const localInput = e.target.value
                    setSettings({ ...settings, localInput })
                    void saveSettings({ localInput })
                  }}
                >
                  {inputs.map((i) => (
                    <option key={i.value} value={i.value}>
                      {i.label}（{i.value}）
                    </option>
                  ))}
                </select>
              </div>

              <div className="field">
                <label>对端输入口</label>
                <select
                  value={settings.peerInput}
                  onChange={(e) => {
                    const peerInput = e.target.value
                    setSettings({ ...settings, peerInput })
                    void saveSettings({ peerInput })
                  }}
                >
                  {inputs.map((i) => (
                    <option key={i.value} value={i.value}>
                      {i.label}（{i.value}）
                    </option>
                  ))}
                </select>
              </div>

              <div className="field">
                <label>服务端口</label>
                <input
                  type="number"
                  value={settings.port}
                  onChange={(e) =>
                    setSettings({ ...settings, port: Number(e.target.value) || 37890 })
                  }
                  onBlur={() => void saveSettings({ port: settings.port })}
                />
              </div>

              <div className="toggle">
                <span>开机自启</span>
                <button
                  className={`switch ${settings.openAtLogin ? 'on' : ''}`}
                  onClick={() => void saveSettings({ openAtLogin: !settings.openAtLogin })}
                />
              </div>

              <div className="toggle">
                <span>自动重连</span>
                <button
                  className={`switch ${settings.autoReconnect ? 'on' : ''}`}
                  onClick={() => void saveSettings({ autoReconnect: !settings.autoReconnect })}
                />
              </div>
              {settings.pairId || settings.lastHost ? (
                <button
                  className="btn btn-secondary"
                  onClick={async () => {
                    const next = await window.peerswitch.forgetPairing()
                    setSettings(next)
                    setHostIp('')
                    setLog('已清除配对')
                  }}
                >
                  清除配对
                </button>
              ) : null}

              <div className="toggle">
                <span>关闭后留在托盘</span>
                <button
                  className={`switch ${settings.closeToTray ? 'on' : ''}`}
                  onClick={() => void saveSettings({ closeToTray: !settings.closeToTray })}
                />
              </div>

              <div className="toggle">
                <span>切换时改输入源</span>
                <button
                  className={`switch ${settings.swapMonitorOnSwitch ? 'on' : ''}`}
                  onClick={() =>
                    void saveSettings({ swapMonitorOnSwitch: !settings.swapMonitorOnSwitch })
                  }
                />
              </div>

              <div className="toggle">
                <span>自动接受文件</span>
                <button
                  className={`switch ${settings.autoAcceptFiles ? 'on' : ''}`}
                  onClick={() => void saveSettings({ autoAcceptFiles: !settings.autoAcceptFiles })}
                />
              </div>

              <div className="toggle">
                <span>右键传送至对端</span>
                <button
                  className={`switch ${settings.contextMenuSend ? 'on' : ''}`}
                  onClick={() =>
                    void saveSettings({ contextMenuSend: !settings.contextMenuSend })
                  }
                />
              </div>

              <button
                className="btn btn-secondary"
                onClick={async () => {
                  const r = await window.peerswitch.switchLocal(settings.peerInput)
                  setLog(r.detail)
                }}
              >
                测试切换
              </button>
            </div>
          </aside>
        )}
      </main>
    </div>
  )
}
