import Store from 'electron-store'
import { app } from 'electron'
import { join } from 'path'
import { hostname } from 'os'
import { newDeviceId } from './discovery'

export type PeerSwitchSettings = {
  displayName: string
  port: number
  hotkey: string
  localInput: string
  peerInput: string
  downloadDir: string
  autoAcceptFiles: boolean
  swapMonitorOnSwitch: boolean
  openAtLogin: boolean
  autoHost: boolean
  /** 记住配对后自动重连（通过 pairId 局域网发现，两边 IP 可变） */
  autoReconnect: boolean
  closeToTray: boolean
  lastHost: string
  lastCode: string
  lastRole: 'host' | 'client' | ''
  pairRemembered: boolean
  /** 配对身份：两边相同，用于 IP 变化后互相发现 */
  pairId: string
  /** 本机稳定设备 ID */
  deviceId: string
  lastPeerName: string
}

const defaults: PeerSwitchSettings = {
  displayName: '',
  port: 37890,
  hotkey: process.platform === 'darwin' ? 'Command+Option+Q' : 'Control+Alt+Q',
  localInput: '0x0F',
  peerInput: '0x11',
  downloadDir: '',
  autoAcceptFiles: true,
  swapMonitorOnSwitch: true,
  openAtLogin: true,
  autoHost: true,
  autoReconnect: true,
  closeToTray: true,
  lastHost: '',
  lastCode: '666666',
  lastRole: '',
  pairRemembered: false,
  pairId: '',
  deviceId: '',
  lastPeerName: ''
}

export const store = new Store<PeerSwitchSettings>({
  name: 'peerswitch-settings',
  defaults
})

function defaultDownloadDir(): string {
  if (process.platform === 'win32') {
    return join(app.getPath('desktop'), '传输')
  }
  return join(app.getPath('downloads'), 'PeerSwitch')
}

export function getSettings(): PeerSwitchSettings {
  const s = { ...defaults, ...store.store }
  if (!s.displayName) {
    s.displayName = hostname().split('.')[0] || '本机'
  }
  if (!s.lastCode || !/^\d{6}$/.test(s.lastCode)) {
    s.lastCode = '666666'
  }
  if (!s.deviceId) {
    s.deviceId = newDeviceId()
    store.set('deviceId', s.deviceId)
  }
  if (!store.get('__reconnect_v2')) {
    store.set('autoReconnect', true)
    store.set('__reconnect_v2', true)
    s.autoReconnect = true
  }
  if (s.pairId || s.lastHost) s.pairRemembered = true
  const winLegacy = join(app.getPath('downloads'), 'PeerSwitch')
  if (!s.downloadDir) {
    s.downloadDir = defaultDownloadDir()
  } else if (process.platform === 'win32' && s.downloadDir === winLegacy) {
    s.downloadDir = defaultDownloadDir()
    store.set('downloadDir', s.downloadDir)
  }
  return s
}

export function updateSettings(patch: Partial<PeerSwitchSettings>): PeerSwitchSettings {
  const next = { ...getSettings(), ...patch }
  store.set(next)
  return next
}

export function rememberPairing(opts: {
  host?: string
  code?: string
  role?: 'host' | 'client' | ''
  pairId?: string
  peerName?: string
}): void {
  const cur = getSettings()
  updateSettings({
    lastHost: opts.host ?? cur.lastHost,
    lastCode: opts.code || cur.lastCode || '666666',
    lastRole: opts.role ?? cur.lastRole,
    pairId: opts.pairId || cur.pairId,
    lastPeerName: opts.peerName ?? cur.lastPeerName,
    pairRemembered: true,
    autoReconnect: true
  })
}

export function forgetPairing(): PeerSwitchSettings {
  return updateSettings({
    lastHost: '',
    lastRole: '',
    pairRemembered: false,
    lastCode: '666666',
    pairId: '',
    lastPeerName: ''
  })
}
