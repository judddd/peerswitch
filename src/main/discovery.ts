import dgram from 'dgram'
import { networkInterfaces, hostname } from 'os'
import { EventEmitter } from 'events'
import { randomBytes } from 'crypto'
import { getSettings } from './store'

export const DISCOVERY_PORT = 37891

export type PeerBeacon = {
  v: 1
  kind: 'peerswitch'
  pairId: string
  deviceId: string
  name: string
  tcpPort: number
  code: string
}

function localIPv4s(): string[] {
  const out: string[] = []
  const ifs = networkInterfaces()
  for (const list of Object.values(ifs)) {
    if (!list) continue
    for (const info of list) {
      if (info.family !== 'IPv4' && (info.family as unknown) !== 4) continue
      if (info.internal) continue
      out.push(info.address)
    }
  }
  return out
}

function subnetBroadcasts(): string[] {
  const set = new Set<string>(['255.255.255.255'])
  for (const ip of localIPv4s()) {
    const p = ip.split('.').map(Number)
    if (p.length === 4) set.add(`${p[0]}.${p[1]}.${p[2]}.255`)
  }
  return [...set]
}

/** 局域网 UDP 广播发现：两边 IP 都变也能靠 pairId 找到对方 */
export class Discovery extends EventEmitter {
  private socket: dgram.Socket | null = null
  private timer: NodeJS.Timeout | null = null
  private deviceId: string
  private selfIps = new Set<string>()

  constructor(deviceId: string) {
    super()
    this.deviceId = deviceId
  }

  start(): void {
    if (this.socket) return
    this.selfIps = new Set(localIPv4s())
    this.socket = dgram.createSocket({ type: 'udp4', reuseAddr: true })
    this.socket.on('message', (msg, rinfo) => {
      if (this.selfIps.has(rinfo.address)) return
      try {
        const data = JSON.parse(msg.toString('utf8')) as PeerBeacon
        if (data?.kind !== 'peerswitch' || data.v !== 1) return
        if (!data.pairId || data.deviceId === this.deviceId) return
        this.emit('peer', {
          ip: rinfo.address,
          beacon: data
        })
      } catch {
        /* ignore */
      }
    })
    this.socket.on('error', (err) => this.emit('error', err))
    this.socket.bind(DISCOVERY_PORT, () => {
      try {
        this.socket?.setBroadcast(true)
      } catch {
        /* ignore */
      }
      this.broadcast()
      this.timer = setInterval(() => this.broadcast(), 2000)
    })
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    if (this.socket) {
      try {
        this.socket.close()
      } catch {
        /* ignore */
      }
      this.socket = null
    }
  }

  broadcast(): void {
    if (!this.socket) return
    this.selfIps = new Set(localIPv4s())
    const settings = getSettings()
    const pairId = settings.pairId
    if (!pairId) return

    const payload: PeerBeacon = {
      v: 1,
      kind: 'peerswitch',
      pairId,
      deviceId: this.deviceId,
      name: settings.displayName || hostname(),
      tcpPort: settings.port,
      code: settings.lastCode || '666666'
    }
    const buf = Buffer.from(JSON.stringify(payload), 'utf8')
    for (const target of subnetBroadcasts()) {
      try {
        this.socket.send(buf, 0, buf.length, DISCOVERY_PORT, target)
      } catch {
        /* ignore */
      }
    }
  }
}

export function newPairId(): string {
  return randomBytes(8).toString('hex')
}

export function newDeviceId(): string {
  return randomBytes(6).toString('hex')
}
