import net from 'net'
import { EventEmitter } from 'events'
import { createWriteStream, createReadStream, existsSync, statSync } from 'fs'
import { basename, join } from 'path'
import { randomBytes } from 'crypto'
import { getSettings, rememberPairing, updateSettings } from './store'
import { ensureDownloadDir, switchMonitorInput } from './ddc'
import { DEFAULT_PAIR_CODE } from './lan-scan'
import { Discovery, newPairId } from './discovery'

export type ConnState =
  | { status: 'idle' }
  | { status: 'hosting'; code: string; port: number }
  | { status: 'connecting' }
  | { status: 'connected'; peerName: string; role: 'host' | 'client'; remoteAddress: string }

type WireMsg =
  | { type: 'hello'; name: string; code: string; role: 'host' | 'client'; pairId?: string }
  | { type: 'hello-ok'; name: string; pairId: string }
  | { type: 'hello-fail'; reason: string }
  | { type: 'switch'; peerInput: string; localInput: string; from: string }
  | { type: 'switch-done'; ok: boolean; detail: string; from: string }
  | { type: 'file-offer'; id: string; name: string; size: number }
  | { type: 'file-accept'; id: string }
  | { type: 'file-reject'; id: string }
  | { type: 'file-chunk'; id: string; data: string; seq: number }
  | { type: 'file-end'; id: string }
  | { type: 'ping' }
  | { type: 'pong' }

function encode(msg: WireMsg): Buffer {
  const body = Buffer.from(JSON.stringify(msg), 'utf8')
  const header = Buffer.alloc(4)
  header.writeUInt32BE(body.length, 0)
  return Buffer.concat([header, body])
}

class FrameReader {
  private buf = Buffer.alloc(0)
  push(chunk: Buffer): WireMsg[] {
    this.buf = Buffer.concat([this.buf, chunk])
    const out: WireMsg[] = []
    while (this.buf.length >= 4) {
      const len = this.buf.readUInt32BE(0)
      if (this.buf.length < 4 + len) break
      const body = this.buf.subarray(4, 4 + len)
      this.buf = this.buf.subarray(4 + len)
      try {
        out.push(JSON.parse(body.toString('utf8')) as WireMsg)
      } catch {
        /* 丢弃坏帧 */
      }
    }
    return out
  }
}

export class PeerSession extends EventEmitter {
  private server: net.Server | null = null
  private socket: net.Socket | null = null
  private reader = new FrameReader()
  private expectedCode = ''
  private role: 'host' | 'client' | null = null
  private keepalive: NodeJS.Timeout | null = null
  private reconnectTimer: NodeJS.Timeout | null = null
  private reconnectAttempt = 0
  private suppressReconnect = false
  private joining = false
  private lastAliveAt = 0
  private discovery: Discovery | null = null
  private incoming = new Map<
    string,
    { name: string; size: number; path: string; stream: ReturnType<typeof createWriteStream>; received: number }
  >()
  state: ConnState = { status: 'idle' }

  /** 只有客户端才主动拨号；主机只监听，避免两边互拨把连接掐死 */
  private shouldAutoDial(): boolean {
    return getSettings().lastRole === 'client'
  }

  private setState(s: ConnState): void {
    this.state = s
    this.emit('state', s)
  }

  private send(msg: WireMsg): void {
    if (!this.socket || this.socket.destroyed) return
    this.socket.write(encode(msg))
  }

  private startKeepalive(): void {
    this.stopKeepalive()
    this.lastAliveAt = Date.now()
    this.keepalive = setInterval(() => {
      if (this.state.status !== 'connected') return
      // 僵尸连接：对端已死但仍占着 socket，会导致新连接被拒
      if (Date.now() - this.lastAliveAt > 18000) {
        this.emit('log', '心跳超时，清理旧连接')
        this.socket?.destroy()
        return
      }
      this.send({ type: 'ping' })
    }, 5000)
  }

  private stopKeepalive(): void {
    if (this.keepalive) {
      clearInterval(this.keepalive)
      this.keepalive = null
    }
  }

  private attachSocket(socket: net.Socket, role: 'host' | 'client'): void {
    this.socket = socket
    this.role = role
    this.reader = new FrameReader()
    this.lastAliveAt = Date.now()
    socket.setNoDelay(true)
    socket.setKeepAlive(true, 3000)
    this.startKeepalive()
    socket.on('data', (chunk) => {
      this.lastAliveAt = Date.now()
      for (const msg of this.reader.push(chunk)) void this.onMessage(msg)
    })
    socket.on('close', () => {
      // 已被新连接顶替
      if (this.socket !== socket) return
      this.cleanupSocket()
      if (this.server) {
        this.setState({
          status: 'hosting',
          code: this.expectedCode,
          port: getSettings().port
        })
      } else {
        this.setState({ status: 'idle' })
      }
      this.emit('log', '对端已断开')
      const s = getSettings()
      if (s.autoReconnect && this.shouldAutoDial() && (s.pairId || s.lastHost)) {
        this.scheduleReconnect('连接断开')
      }
    })
    socket.on('error', (err) => {
      if (this.socket === socket) this.emit('log', `连接错误：${err.message}`)
    })
  }

  /** 已有会话时仍接受新 hello：配对码正确则顶替旧连接（Mac 重连不被 Win 拒掉） */
  private acceptInbound(socket: net.Socket): void {
    if (!this.socket || this.socket.destroyed) {
      this.attachSocket(socket, 'host')
      return
    }

    const reader = new FrameReader()
    const timer = setTimeout(() => {
      socket.removeAllListeners()
      socket.destroy()
    }, 5000)

    const finish = (): void => {
      clearTimeout(timer)
    }

    socket.on('data', (chunk) => {
      for (const msg of reader.push(chunk)) {
        if (msg.type !== 'hello') continue
        finish()
        if (msg.code !== this.expectedCode) {
          try {
            socket.write(encode({ type: 'hello-fail', reason: '配对码错误' }))
          } catch {
            /* ignore */
          }
          socket.end()
          return
        }
        const old = this.socket
        this.socket = null
        if (old && !old.destroyed) {
          old.removeAllListeners()
          old.destroy()
        }
        this.attachSocket(socket, 'host')
        void this.onMessage(msg)
        return
      }
    })
    socket.on('error', () => {
      finish()
      socket.destroy()
    })
    socket.on('close', () => finish())
  }

  private ensureDiscovery(): void {
    if (this.discovery) return
    const settings = getSettings()
    this.discovery = new Discovery(settings.deviceId)
    this.discovery.on('peer', (info: { ip: string; beacon: { pairId: string; name: string; code: string } }) => {
      const s = getSettings()
      if (!s.autoReconnect || this.suppressReconnect || !this.shouldAutoDial()) return
      if (!s.pairId || info.beacon.pairId !== s.pairId) return
      if (this.state.status === 'connected' || this.state.status === 'connecting' || this.joining) return
      this.emit('log', `发现 ${info.beacon.name}，正在连接…`)
      void this.join(info.ip, info.beacon.code || s.lastCode || DEFAULT_PAIR_CODE)
        .then(() => {
          this.reconnectAttempt = 0
          this.clearReconnectTimer()
        })
        .catch((e) => {
          this.emit('log', `发现后连接失败：${e instanceof Error ? e.message : String(e)}`)
          this.scheduleReconnect()
        })
    })
    this.discovery.start()
  }

  private cleanupSocket(): void {
    this.stopKeepalive()
    if (this.socket) {
      this.socket.removeAllListeners()
      this.socket.destroy()
      this.socket = null
    }
    this.role = null
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  /** 自动重连：仅客户端拨号；主机只广播等待接入 */
  scheduleReconnect(reason?: string): void {
    this.clearReconnectTimer()
    if (this.suppressReconnect) return
    const settings = getSettings()
    if (!settings.autoReconnect || (!settings.lastHost && !settings.pairId)) return
    if (this.state.status === 'connected' || this.state.status === 'connecting') return

    this.ensureDiscovery()
    this.discovery?.broadcast()

    if (!this.shouldAutoDial()) {
      if (reason) this.emit('log', `${reason}，等待对端连入…`)
      return
    }

    const delay = Math.min(30000, 1500 * Math.pow(1.6, this.reconnectAttempt))
    this.reconnectAttempt += 1
    if (reason) {
      this.emit('log', `${reason}，${Math.round(delay / 1000)} 秒后重连…`)
    }
    this.reconnectTimer = setTimeout(() => {
      void this.tryAutoReconnect()
    }, delay)
  }

  async tryAutoReconnect(): Promise<void> {
    const settings = getSettings()
    if (!settings.autoReconnect || !this.shouldAutoDial()) return
    if (this.state.status === 'connected') {
      this.reconnectAttempt = 0
      return
    }
    this.ensureDiscovery()
    this.discovery?.broadcast()

    if (settings.lastHost) {
      try {
        this.emit('log', `重连 ${settings.lastHost}…`)
        await this.join(settings.lastHost, settings.lastCode || DEFAULT_PAIR_CODE)
        this.reconnectAttempt = 0
        this.emit('log', '已重连')
        return
      } catch (e) {
        this.emit(
          'log',
          `重连失败：${e instanceof Error ? e.message : String(e)}，继续寻找…`
        )
      }
    }
    this.scheduleReconnect()
  }

  private async onMessage(msg: WireMsg): Promise<void> {
    switch (msg.type) {
      case 'hello': {
        if (this.role === 'host') {
          if (msg.code !== this.expectedCode) {
            this.send({ type: 'hello-fail', reason: '配对码错误' })
            this.socket?.end()
            return
          }
          const settings = getSettings()
          const pairId = msg.pairId || settings.pairId || newPairId()
          const name = settings.displayName
          this.send({ type: 'hello-ok', name, pairId })
          rememberPairing({
            host: this.socket?.remoteAddress?.replace(/^::ffff:/, '') || settings.lastHost,
            code: this.expectedCode,
            role: 'host',
            pairId,
            peerName: msg.name
          })
          this.ensureDiscovery()
          this.discovery?.broadcast()
          this.reconnectAttempt = 0
          this.clearReconnectTimer()
          this.setState({
            status: 'connected',
            peerName: msg.name,
            role: 'host',
            remoteAddress: this.socket?.remoteAddress || ''
          })
          this.emit('log', `已连接：${msg.name}`)
          this.emit('handshake-ok')
        }
        break
      }
      case 'hello-ok': {
        const settings = getSettings()
        const pairId = msg.pairId || settings.pairId || newPairId()
        rememberPairing({
          host: settings.lastHost,
          code: this.expectedCode || DEFAULT_PAIR_CODE,
          role: 'client',
          pairId,
          peerName: msg.name
        })
        this.ensureDiscovery()
        this.discovery?.broadcast()
        this.reconnectAttempt = 0
        this.clearReconnectTimer()
        this.setState({
          status: 'connected',
          peerName: msg.name,
          role: 'client',
          remoteAddress: this.socket?.remoteAddress || ''
        })
        this.emit('log', `已连接：${msg.name}`)
        this.emit('handshake-ok')
        break
      }
      case 'hello-fail': {
        this.emit('log', msg.reason)
        this.emit('handshake-fail', msg.reason)
        this.disconnect(false)
        break
      }
      case 'switch': {
        // 对端请求：把显示器切到「请求方」的输入口（仅当本机当前在亮着的输入上时 DDC 才有效）
        const settings = getSettings()
        if (settings.swapMonitorOnSwitch) {
          const result = await switchMonitorInput(msg.peerInput)
          this.send({
            type: 'switch-done',
            ok: result.ok,
            detail: result.detail,
            from: settings.displayName
          })
          this.emit('switch-result', result)
          this.emit('log', `收到对端切换请求 → ${result.detail}`)
        } else {
          this.send({
            type: 'switch-done',
            ok: true,
            detail: '已关闭显示器切换，仅通知对端',
            from: settings.displayName
          })
        }
        break
      }
      case 'switch-done': {
        this.emit('switch-done', msg)
        this.emit('switch-result', { ok: msg.ok, detail: `${msg.from}：${msg.detail}` })
        break
      }
      case 'file-offer': {
        const settings = getSettings()
        if (!settings.autoAcceptFiles) {
          this.emit('file-offer', msg)
          return
        }
        await this.acceptFile(msg.id, msg.name, msg.size)
        break
      }
      case 'file-accept': {
        this.emit('file-accepted', msg.id)
        break
      }
      case 'file-reject': {
        this.emit('file-rejected', msg.id)
        break
      }
      case 'file-chunk': {
        const rec = this.incoming.get(msg.id)
        if (!rec) return
        const buf = Buffer.from(msg.data, 'base64')
        rec.stream.write(buf)
        rec.received += buf.length
        this.emit('file-progress', {
          id: msg.id,
          name: rec.name,
          received: rec.received,
          size: rec.size,
          direction: 'in' as const
        })
        break
      }
      case 'file-end': {
        const rec = this.incoming.get(msg.id)
        if (!rec) return
        rec.stream.end()
        this.incoming.delete(msg.id)
        this.emit('file-done', { id: msg.id, name: rec.name, path: rec.path, direction: 'in' as const })
        this.emit('log', `已接收文件：${rec.name}`)
        break
      }
      case 'ping':
        this.send({ type: 'pong' })
        break
      default:
        break
    }
  }

  /** 始终保持端口监听，便于对端扫描发现（即使本机是客户端也要听） */
  async ensureServer(preferCode?: string): Promise<{ code: string; port: number }> {
    const settings = getSettings()
    const code =
      preferCode && /^\d{6}$/.test(preferCode) ? preferCode : DEFAULT_PAIR_CODE
    this.expectedCode = code

    if (this.server) {
      return { code, port: settings.port }
    }

    await new Promise<void>((resolve, reject) => {
      this.server = net.createServer((socket) => {
        this.acceptInbound(socket)
      })
      this.server.once('error', (err) => {
        this.server = null
        reject(err)
      })
      this.server.listen(settings.port, '0.0.0.0', () => resolve())
    })

    this.ensureDiscovery()
    return { code, port: settings.port }
  }

  async startHost(preferCode?: string): Promise<{ code: string; port: number }> {
    this.cleanupSocket()
    const { code, port } = await this.ensureServer(preferCode)
    // 后台监听不等于改身份：已记住的客户端不要被改成 host
    const prevRole = getSettings().lastRole
    updateSettings({
      lastCode: code,
      lastRole: prevRole === 'client' ? 'client' : 'host'
    })
    this.ensureDiscovery()
    this.discovery?.broadcast()
    this.setState({ status: 'hosting', code, port })
    this.emit('log', `主机已启动 · ${port}`)
    return { code, port }
  }

  async join(host: string, code: string): Promise<void> {
    if (this.joining) throw new Error('正在连接中')
    this.joining = true
    try {
      const settings = getSettings()
      const pair = code && /^\d{6}$/.test(code) ? code : DEFAULT_PAIR_CODE
      rememberPairing({
        host,
        code: pair,
        role: 'client',
        pairId: settings.pairId || undefined
      })
      await this.ensureServer(pair)
      this.cleanupSocket()
      this.expectedCode = pair
      this.setState({ status: 'connecting' })

      await new Promise<void>((resolve, reject) => {
        let settled = false
        const settle = (fn: () => void): void => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          this.off('handshake-ok', onOk)
          this.off('handshake-fail', onFail)
          fn()
        }
        const onOk = (): void => settle(() => resolve())
        const onFail = (reason: string): void =>
          settle(() => reject(new Error(reason || '配对失败')))
        const timer = setTimeout(() => {
          settle(() => {
            socket.destroy()
            reject(new Error('配对超时'))
          })
        }, 8000)

        this.once('handshake-ok', onOk)
        this.once('handshake-fail', onFail)

        const socket = net.createConnection({ host, port: settings.port }, () => {
          this.attachSocket(socket, 'client')
          this.send({
            type: 'hello',
            name: settings.displayName,
            code: pair,
            role: 'client',
            pairId: getSettings().pairId || undefined
          })
        })
        socket.once('error', (err) => {
          if (this.server) {
            this.setState({ status: 'hosting', code: this.expectedCode, port: settings.port })
          } else {
            this.setState({ status: 'idle' })
          }
          settle(() => reject(err))
        })
        socket.once('close', () => {
          if (!settled && this.state.status !== 'connected') {
            settle(() => reject(new Error('连接被对端关闭')))
          }
        })
      })
    } finally {
      this.joining = false
    }
  }

  /** forget=true 时停止自动重连；默认断开仍保留配对记忆 */
  disconnect(forget = false): void {
    if (forget) {
      this.suppressReconnect = true
      this.clearReconnectTimer()
    }
    this.cleanupSocket()
    // 默认保持端口监听，方便再次被扫描；仅完全退出时关闭服务
    if (this.server && this.expectedCode) {
      this.setState({
        status: 'hosting',
        code: this.expectedCode,
        port: getSettings().port
      })
      this.emit('log', forget ? '已断开并清除配对' : '已断开')
      if (!forget) this.scheduleReconnect()
      return
    }
    if (this.server) {
      this.server.close()
      this.server = null
    }
    this.expectedCode = ''
    this.setState({ status: 'idle' })
  }

  /** 应用退出时关闭全部 */
  shutdown(): void {
    this.suppressReconnect = true
    this.clearReconnectTimer()
    this.discovery?.stop()
    this.discovery = null
    this.cleanupSocket()
    if (this.server) {
      this.server.close()
      this.server = null
    }
    this.expectedCode = ''
    this.setState({ status: 'idle' })
  }

  /** 确保后台监听仍在（解锁/唤醒后调用） */
  async ensureListening(): Promise<void> {
    const settings = getSettings()
    this.suppressReconnect = false
    try {
      await this.ensureServer(DEFAULT_PAIR_CODE)
      if (this.state.status === 'idle') {
        this.setState({
          status: 'hosting',
          code: this.expectedCode || DEFAULT_PAIR_CODE,
          port: settings.port
        })
      }
    } catch (e) {
      this.emit('log', `恢复监听失败：${e instanceof Error ? e.message : String(e)}`)
    }
    if (
      settings.autoReconnect &&
      this.shouldAutoDial() &&
      (settings.lastHost || settings.pairId) &&
      this.state.status !== 'connected'
    ) {
      this.scheduleReconnect('系统恢复')
    }
  }

  async requestSwitch(): Promise<{ ok: boolean; detail: string }> {
    const settings = getSettings()
    if (!settings.swapMonitorOnSwitch) {
      return { ok: false, detail: '设置中已关闭「切换时改显示器输入源」' }
    }

    // 未连接：只做本机 DDC，切到对端输入口
    if (this.state.status !== 'connected') {
      return switchMonitorInput(settings.peerInput)
    }

    /**
     * 关键路径（避免「切走又被对端切回来」）：
     * 1) 先本机发 DDC → 对端输入口（当前画面在本机时有效）
     * 2) 本机成功则结束，绝不通知对端再发 DDC（否则对端亮起后又会切回本机）
     * 3) 本机失败（多半当前画面在对端）才请求对端：把输入切到本机输入口
     */
    const local = await switchMonitorInput(settings.peerInput)
    if (local.ok) {
      this.emit('log', `已切换到 ${settings.peerInput}`)
      return {
        ok: true,
        detail: `已切换到对端信号源（${settings.peerInput}）`
      }
    }

    this.emit('log', `本机未切成功，请求对端切换…`)
    this.send({
      type: 'switch',
      peerInput: settings.localInput,
      localInput: settings.peerInput,
      from: settings.displayName
    })

    const remote = await new Promise<{ ok: boolean; detail: string }>((resolve) => {
      const timer = setTimeout(() => {
        cleanup()
        resolve({ ok: false, detail: '等待对端切换超时' })
      }, 4000)
      const onDone = (msg: { ok: boolean; detail: string; from: string }): void => {
        cleanup()
        resolve({ ok: msg.ok, detail: `${msg.from}：${msg.detail}` })
      }
      const cleanup = (): void => {
        clearTimeout(timer)
        this.off('switch-done', onDone)
      }
      this.on('switch-done', onDone)
    })

    return {
      ok: remote.ok,
      detail: remote.ok
        ? `对端已切换到本机信号源（${settings.localInput}）。${remote.detail}`
        : `切换未完成。本机：${local.detail}；对端：${remote.detail}`
    }
  }

  async acceptFile(id: string, name: string, size: number): Promise<void> {
    const settings = getSettings()
    await ensureDownloadDir(settings.downloadDir)
    const safe = name.replace(/[\\/:*?"<>|]/g, '_')
    const path = join(settings.downloadDir, safe)
    const stream = createWriteStream(path)
    this.incoming.set(id, { name: safe, size, path, stream, received: 0 })
    this.send({ type: 'file-accept', id })
  }

  rejectFile(id: string): void {
    this.send({ type: 'file-reject', id })
  }

  async sendFile(filePath: string): Promise<string> {
    if (this.state.status !== 'connected' || !this.socket) {
      throw new Error('尚未连接对端')
    }
    if (!existsSync(filePath)) throw new Error('文件不存在')
    const size = statSync(filePath).size
    const name = basename(filePath)
    const id = randomBytes(8).toString('hex')

    this.send({ type: 'file-offer', id, name, size })

    await new Promise<void>((resolve, reject) => {
      const onAccept = (acceptedId: string): void => {
        if (acceptedId !== id) return
        cleanup()
        resolve()
      }
      const onReject = (rejectedId: string): void => {
        if (rejectedId !== id) return
        cleanup()
        reject(new Error('对端拒绝接收文件'))
      }
      const timer = setTimeout(() => {
        cleanup()
        reject(new Error('等待对端接受超时'))
      }, 30000)
      const cleanup = (): void => {
        clearTimeout(timer)
        this.off('file-accepted', onAccept)
        this.off('file-rejected', onReject)
      }
      this.on('file-accepted', onAccept)
      this.on('file-rejected', onReject)
    })

    const stream = createReadStream(filePath, { highWaterMark: 64 * 1024 })
    let seq = 0
    let sent = 0
    for await (const chunk of stream) {
      const buf = chunk as Buffer
      this.send({ type: 'file-chunk', id, data: buf.toString('base64'), seq })
      seq += 1
      sent += buf.length
      this.emit('file-progress', {
        id,
        name,
        received: sent,
        size,
        direction: 'out' as const
      })
      await new Promise((r) => setImmediate(r))
    }
    this.send({ type: 'file-end', id })
    this.emit('file-done', { id, name, path: filePath, direction: 'out' as const })
    this.emit('log', `已发送文件：${name}`)
    return id
  }
}

export const session = new PeerSession()
