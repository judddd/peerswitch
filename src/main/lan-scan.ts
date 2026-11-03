import net from 'net'
import { networkInterfaces } from 'os'
import { getSettings } from './store'

export type ScanHit = {
  ip: string
  port: number
  ms: number
}

function localIPv4s(): { ip: string; prefix: string }[] {
  const out: { ip: string; prefix: string }[] = []
  const ifs = networkInterfaces()
  for (const list of Object.values(ifs)) {
    if (!list) continue
    for (const info of list) {
      if (info.family !== 'IPv4' && (info.family as unknown) !== 4) continue
      if (info.internal) continue
      const parts = info.address.split('.').map(Number)
      if (parts.length !== 4) continue
      // 跳过链路本地 / 明显非局域网
      if (parts[0] === 169 && parts[1] === 254) continue
      out.push({
        ip: info.address,
        prefix: `${parts[0]}.${parts[1]}.${parts[2]}`
      })
    }
  }
  return out
}

function probe(ip: string, port: number, timeoutMs: number): Promise<number | null> {
  return new Promise((resolve) => {
    const started = Date.now()
    const socket = net.createConnection({ host: ip, port })
    let done = false
    const finish = (ok: boolean): void => {
      if (done) return
      done = true
      socket.destroy()
      resolve(ok ? Date.now() - started : null)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
  })
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let cursor = 0
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++
      results[i] = await worker(items[i])
    }
  })
  await Promise.all(runners)
  return results
}

/** 扫描本机所在 /24 网段上开放 PeerSwitch 端口的主机 */
export async function scanLanPeers(
  onProgress?: (done: number, total: number) => void
): Promise<ScanHit[]> {
  const port = getSettings().port
  const locals = localIPv4s()
  const self = new Set(locals.map((x) => x.ip))
  const prefixes = [...new Set(locals.map((x) => x.prefix))]
  if (prefixes.length === 0) return []

  const targets: string[] = []
  for (const prefix of prefixes) {
    for (let i = 1; i <= 254; i++) {
      const ip = `${prefix}.${i}`
      if (!self.has(ip)) targets.push(ip)
    }
  }

  let done = 0
  const total = targets.length
  const hits: ScanHit[] = []

  await mapPool(targets, 64, async (ip) => {
    const ms = await probe(ip, port, 350)
    done += 1
    if (done % 16 === 0 || done === total) onProgress?.(done, total)
    if (ms != null) hits.push({ ip, port, ms })
    return ms
  })

  hits.sort((a, b) => a.ms - b.ms || a.ip.localeCompare(b.ip))
  return hits
}

export const DEFAULT_PAIR_CODE = '666666'
