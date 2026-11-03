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
  const [status, setStatus] = useState('拖入文件即可上传')

  useEffect(() => {
    void window.peerswitch.getState().then((s: ConnState) => {
      setConnected(s.status === 'connected')
      if (s.status === 'connected') setPeer(s.peerName)
    })
    const off = window.peerswitch.on('conn-state', (p) => {
      const s = p as ConnState
      setConnected(s.status === 'connected')
      setPeer(s.status === 'connected' ? s.peerName : '')
    })
    const offLog = window.peerswitch.on('log', (p) => setStatus(String(p)))
    return () => {
      off()
      offLog()
    }
  }, [])

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
    <div className="shell">
      <div className="drag-bar" />
      <button
        className="close"
        title="隐藏"
        onClick={() => void window.peerswitch.hideDropWindow()}
      >
        ×
      </button>
      <div
        className={`panel ${active ? 'active' : ''} ${connected ? 'ready' : ''}`}
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
        onClick={() => {
          if (!connected) {
            setStatus('请先连接对端')
            void window.peerswitch.showMainWindow()
            return
          }
          void window.peerswitch.pickAndSendFiles()
        }}
      >
        <strong>{active ? '松开即可上传' : '拖入文件上传'}</strong>
        <span>{connected ? `对端：${peer || '已连接'}` : '尚未连接对端'}</span>
        <span className="hint">{status}</span>
      </div>
    </div>
  )
}
