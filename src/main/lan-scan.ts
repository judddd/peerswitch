import net from 'net'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { networkInterfaces } from 'os'
import { getSettings } from './store'

const execFileAsync = promisify(execFile)

export type ScanHit = {
  ip: string
  port: number
  ms: number
}

function isPrivateLan(ip: string): boolean {
  const p = ip.split('.').map(Number)
  if (p.length !== 4 || p.some((n) => Number.isNaN(n))) return false
  if (p[0] === 10) return true
  if (p[0] === 192 && p[1] === 168) return true
  if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true
  return false
}

function localIPv4s(): { ip: string; prefix: string }[] {
  const out: { ip: string; prefix: string }[] = []
  const ifs = networkInterfaces()
  for (const list of Object.values(ifs)) {
    if (!list) continue
    for (const info of list) {
      if (info.family !== 'IPv4' && (info.family as unknown) !== 4) continue
      if (info.internal) continue
      if (!isPrivateLan(info.address)) continue
      const parts = info.address.split('.')
      out.push({
        ip: info.address,
        prefix: `${parts[0]}.${parts[1]}.${parts[2]}`
      })
    }
  }
  return out
}

async function arpNeighbors(): Promise<string[]> {
  try {
    const { stdout } =
      process.platform === 'win32'
        ? await execFileAsync('arp', ['-a'], { timeout: 3000, windowsHide: true })
        : await execFileAsync('arp', ['-a', '-n'], { timeout: 3000 })
    const ips = new Set<string>()
    const re = /\b(\d{1,3}(?:\.\d{1,3}){3})\b/g
    let m: RegExpExecArray | null
    while ((m = re.exec(stdout))) {
      const ip = m[1]
      if (isPrivateLan(ip) && !ip.endsWith('.255') && !ip.endsWith('.0')) ips.add(ip)
    }
    return [...ips]
  } catch {
    return []
  }
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
  const runners = Array.from({ length: Math.min(concurrency, items.length || 1) }, async () => {
    while (cursor < items.length) {
      const i = cursor++
      results[i] = await worker(items[i])
    }
  })
  await Promise.all(runners)
  return results
}

/** 扫描本机所在私有网段上开放 PeerSwitch 端口的主机 */
export async function scanLanPeers(
  onProgress?: (done: number, total: number) => void
): Promise<ScanHit[]> {
  const port = getSettings().port
  const locals = localIPv4s()
  const self = new Set(locals.map((x) => x.ip))
  const prefixes = [...new Set(locals.map((x) => x.prefix))]
  if (prefixes.length === 0) return []

  const neighborSet = new Set((await arpNeighbors()).filter((ip) => !self.has(ip)))
  const targets: string[] = []
  const seen = new Set<string>()

  // 先扫 ARP 邻居（更快、更容易命中 Windows）
  for (const ip of neighborSet) {
    const prefix = ip.split('.').slice(0, 3).join('.')
    if (!prefixes.includes(prefix)) continue
    seen.add(ip)
    targets.push(ip)
  }

  for (const prefix of prefixes) {
    for (let i = 1; i <= 254; i++) {
      const ip = `${prefix}.${i}`
      if (self.has(ip) || seen.has(ip)) continue
      seen.add(ip)
      targets.push(ip)
    }
  }

  let done = 0
  const total = targets.length
  const hits: ScanHit[] = []

  await mapPool(targets, 48, async (ip) => {
    // 邻居给更长超时；全网段略短
    const timeout = neighborSet.has(ip) ? 800 : 450
    const ms = await probe(ip, port, timeout)
    done += 1
    if (done % 12 === 0 || done === total) onProgress?.(done, total)
    if (ms != null) hits.push({ ip, port, ms })
    return ms
  })

  hits.sort((a, b) => a.ms - b.ms || a.ip.localeCompare(b.ip))
  return hits
}

export const DEFAULT_PAIR_CODE = '666666'
