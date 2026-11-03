import { useEffect, useState } from 'react'

type ConnState =
  | { status: 'idle' }
  | { status: 'hosting'; code: string; port: number }
  | { status: 'connecting' }
  | { status: 'connected'; peerName: string; role: 'host' | 'client'; remoteAddress: string }

export default function DropApp(): JSX.Element {
  const [active, setActive] = useState(false)
  const [connected, setConnected] = useState(false)
  const [peer, setPeer] = useState('')
  const [openAtLogin, setOpenAtLogin] = useState(true)
  const [status, setStatus] = useState('把文件拖到上方区域即可上传')

  useEffect(() => {
    void (async () => {
      const s = await window.peerswitch.getState()
      setConnected(s.status === 'connected')
      if (s.status === 'connected') setPeer(s.peerName)
      const settings = await window.peerswitch.getSettings()
      setOpenAtLogin(settings.openAtLogin)
    })()
    const offs = [
      window.peerswitch.on('conn-state', (p) => {
        const s = p as ConnState
        setConnected(s.status === 'connected')
        setPeer(s.status === 'connected' ? s.peerName : '')
      }),
      window.peerswitch.on('log', (p) => setStatus(String(p))),
      window.peerswitch.on('settings', (p) => {
        const s = p as { openAtLogin?: boolean }
        if (typeof s.openAtLogin === 'boolean') setOpenAtLogin(s.openAtLogin)
      })
    ]
    return () => offs.forEach((off) => off())
  }, [])

  const run = async (action: string): Promise<void> => {
    await window.peerswitch.trayAction(action)
  }

  const sendFiles = async (fileList: FileList | null): Promise<void> => {
    if (!fileList?.length) return
    if (!connected) {
      setStatus('请先连接对端')
      return
    }
    const paths = Array.from(fileList)
      .map((f) => (f as File & { path?: string }).path)
      .filter((p): p is string => Boolean(p))
    if (!paths.length) {
      setStatus('无法读取文件路径')
      return
    }
    try {
      setStatus(`正在上传 ${paths.length} 个文件…`)
      await window.peerswitch.sendFilePaths(paths)
      setStatus(`已开始发送 ${paths.length} 个文件`)
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="menu-shell">
      <div className="menu-card">
        <div
          className={`drop-area ${active ? 'active' : ''} ${connected ? 'ready' : ''}`}
          onDragEnter={(e) => {
            e.preventDefault()
            setActive(true)
          }}
          onDragOver={(e) => {
            e.preventDefault()
            setActive(true)
          }}
          onDragLeave={(e) => {
            e.preventDefault()
            setActive(false)
          }}
          onDrop={(e) => {
            e.preventDefault()
            setActive(false)
            void sendFiles(e.dataTransfer.files)
          }}
          onClick={() => void run('pick-files')}
        >
          <strong>{active ? '松开即可上传' : '拖入文件到此处上传'}</strong>
          <span>{connected ? `对端：${peer || '已连接'}` : '尚未连接对端'}</span>
        </div>

        <div className="sep" />

        <button className="item" onClick={() => void run('show-main')}>
          显示主窗口
        </button>
        <button className="item" onClick={() => void run('switch')}>
          立即切换屏幕
        </button>
        <button className="item" onClick={() => void run('pick-files')}>
          选择文件传送…
        </button>

        <div className="sep" />

        <button
          className="item"
          onClick={async () => {
            const next = !openAtLogin
            setOpenAtLogin(next)
            await window.peerswitch.updateSettings({ openAtLogin: next })
          }}
        >
          开机自启
          <span className="check">{openAtLogin ? '✓' : ''}</span>
        </button>

        <div className="sep" />

        <button className="item danger" onClick={() => void run('quit')}>
          退出 PeerSwitch
        </button>

        <div className="status">{status}</div>
      </div>
    </div>
  )
}
