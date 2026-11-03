import { app } from 'electron'
import { getSettings, updateSettings } from './store'

/** 同步开机自启（登录项）。macOS/Windows 由 Electron Login Item 实现。 */
export function applyOpenAtLogin(enabled?: boolean): boolean {
  const settings = getSettings()
  const openAtLogin = enabled ?? settings.openAtLogin

  try {
    app.setLoginItemSettings({
      openAtLogin,
      openAsHidden: true,
      name: 'PeerSwitch',
      path: process.execPath,
      args: app.isPackaged ? ['--peerswitch-background'] : ['--peerswitch-background']
    })
  } catch {
    // 开发态部分环境可能不支持，忽略
  }

  if (settings.openAtLogin !== openAtLogin) {
    updateSettings({ openAtLogin })
  }

  const current = app.getLoginItemSettings()
  return Boolean(current.openAtLogin || openAtLogin)
}

export function isLaunchedAtLogin(): boolean {
  try {
    return Boolean(app.getLoginItemSettings().wasOpenedAtLogin)
  } catch {
    return false
  }
}

export function isBackgroundLaunch(): boolean {
  return process.argv.includes('--peerswitch-background') || isLaunchedAtLogin()
}
