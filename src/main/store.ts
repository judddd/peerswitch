import Store from 'electron-store'
import { app } from 'electron'
import { join } from 'path'
import { hostname } from 'os'

export type PeerSwitchSettings = {
  displayName: string
  port: number
  hotkey: string
  localInput: string
  peerInput: string
  downloadDir: string
  autoAcceptFiles: boolean
  swapMonitorOnSwitch: boolean
  /** 开机/登录后自动启动 */
  openAtLogin: boolean
  /** 启动后自动创建主机会话，常驻监听切换指令 */
  autoHost: boolean
  /** 记住配对后自动重连（Windows IP 变化也不影响：由 Windows 主动连固定 Mac） */
  autoReconnect: boolean
  /** 关闭窗口时隐藏到托盘，不退出后台服务 */
  closeToTray: boolean
  lastHost: string
  lastCode: string
  lastRole: 'host' | 'client' | ''
  /** 用户主动点「断开并忘记」前，配对信息会一直保留 */
  pairRemembered: boolean
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
  pairRemembered: false
}

export const store = new Store<PeerSwitchSettings>({
  name: 'peerswitch-settings',
  defaults
})

function defaultDownloadDir(): string {
  // Windows：桌面\传输；其他平台：下载\PeerSwitch
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
  // 旧版默认关闭自动重连 → 升级后默认打开
  if (!store.get('__reconnect_v2')) {
    store.set('autoReconnect', true)
    store.set('__reconnect_v2', true)
    s.autoReconnect = true
  }
  if (s.lastHost) s.pairRemembered = true
  const winLegacy = join(app.getPath('downloads'), 'PeerSwitch')
  if (!s.downloadDir) {
    s.downloadDir = defaultDownloadDir()
  } else if (process.platform === 'win32' && s.downloadDir === winLegacy) {
    // 旧版默认路径迁移到桌面\传输
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

export function rememberPairing(host: string, code: string, role: 'host' | 'client'): void {
  updateSettings({
    lastHost: host,
    lastCode: code || '666666',
    lastRole: role,
    pairRemembered: true,
    autoReconnect: true
  })
}

export function forgetPairing(): PeerSwitchSettings {
  return updateSettings({
    lastHost: '',
    lastRole: '',
    pairRemembered: false,
    lastCode: '666666'
  })
}
