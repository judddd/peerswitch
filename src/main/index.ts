import {
  app,
  BrowserWindow,
  ipcMain,
  globalShortcut,
  dialog,
  shell,
  Menu,
  Tray,
  nativeImage,
  powerMonitor,
  Notification
} from 'electron'
import { join } from 'path'
import { getSettings, updateSettings, type PeerSwitchSettings } from './store'
import { session } from './network'
import { COMMON_INPUTS, ensureDownloadDir, switchMonitorInput } from './ddc'
import { applyOpenAtLogin, isBackgroundLaunch } from './autostart'
import { DEFAULT_PAIR_CODE, scanLanPeers } from './lan-scan'

const isDev = !app.isPackaged

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false

function iconPath(): string {
  if (process.platform === 'win32') {
    return join(app.getAppPath(), 'resources', 'icon.ico')
  }
  const png = join(app.getAppPath(), 'resources', 'icon.png')
  return png
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 920,
    height: 640,
    minWidth: 760,
    minHeight: 520,
    show: false,
    title: 'PeerSwitch',
    backgroundColor: '#F5F5F7',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 16, y: 18 },
    vibrancy: process.platform === 'darwin' ? 'under-window' : undefined,
    visualEffectState: process.platform === 'darwin' ? 'active' : undefined,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    if (!isBackgroundLaunch()) mainWindow?.show()
  })

  mainWindow.on('close', (e) => {
    const { closeToTray } = getSettings()
    if (!isQuitting && closeToTray) {
      e.preventDefault()
      mainWindow?.hide()
      if (process.platform === 'darwin') app.dock?.hide()
    }
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function showMainWindow(): void {
  if (!mainWindow) createWindow()
  mainWindow?.show()
  mainWindow?.focus()
  if (process.platform === 'darwin') app.dock?.show()
}

function broadcast(channel: string, payload: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload)
  }
}

function notify(title: string, body: string): void {
  try {
    if (Notification.isSupported()) {
      new Notification({ title, body }).show()
    }
  } catch {
    /* ignore */
  }
}

async function doSendFiles(): Promise<void> {
  showMainWindow()
  broadcast('open-panel', 'files')
  if (session.state.status !== 'connected') {
    broadcast('log', '请先连接对端后再传送文件')
    notify('PeerSwitch', '请先连接对端后再传送文件')
    return
  }
  const res = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openFile', 'multiSelections'],
    title: '选择要发送的文件'
  })
  if (res.canceled || !res.filePaths.length) return
  for (const p of res.filePaths) {
    try {
      await session.sendFile(p)
    } catch (e) {
      broadcast('log', e instanceof Error ? e.message : String(e))
    }
  }
}

function registerHotkey(): void {
  globalShortcut.unregisterAll()
  const { hotkey } = getSettings()
  const ok = globalShortcut.register(hotkey, () => {
    void doSwitch()
  })
  if (!ok) broadcast('log', `快捷键注册失败：${hotkey}`)

  const fileHotkey = process.platform === 'darwin' ? 'Command+Option+F' : 'Control+Alt+F'
  const okFile = globalShortcut.register(fileHotkey, () => {
    void doSendFiles()
  })
  if (!okFile) broadcast('log', `传文件快捷键注册失败：${fileHotkey}`)
}

async function doSwitch(): Promise<void> {
  const result = await session.requestSwitch()
  broadcast('switch-result', result)
  broadcast('log', result.detail)
  notify('PeerSwitch', result.detail)
}

function buildTray(): void {
  if (tray) return
  let image = nativeImage.createFromPath(iconPath())
  if (image.isEmpty()) {
    // 1x1 兜底，避免托盘创建失败
    image = nativeImage.createEmpty()
  }
  if (process.platform === 'darwin') {
    image = image.resize({ width: 18, height: 18 })
  } else {
    image = image.resize({ width: 16, height: 16 })
  }

  tray = new Tray(image)
  tray.setToolTip('PeerSwitch 后台服务')
  const menu = Menu.buildFromTemplate([
    {
      label: '显示主窗口',
      click: () => showMainWindow()
    },
    {
      label: '立即切换屏幕',
      click: () => void doSwitch()
    },
    {
      label: '传送文件…',
      click: () => void doSendFiles()
    },
    { type: 'separator' },
    {
      label: '开机自启',
      type: 'checkbox',
      checked: getSettings().openAtLogin,
      click: (item) => {
        applyOpenAtLogin(item.checked)
        updateSettings({ openAtLogin: item.checked })
        broadcast('settings', getSettings())
      }
    },
    { type: 'separator' },
    {
      label: '退出 PeerSwitch',
      click: () => {
        isQuitting = true
        app.quit()
      }
    }
  ])
  tray.setContextMenu(menu)
  tray.on('double-click', () => showMainWindow())
  tray.on('click', () => {
    if (process.platform !== 'darwin') showMainWindow()
  })
}

function wireSessionEvents(): void {
  session.on('state', (state) => {
    broadcast('conn-state', state)
    if (tray) {
      const tip =
        state.status === 'connected'
          ? `PeerSwitch · 已连接 ${state.peerName}`
          : state.status === 'hosting'
            ? `PeerSwitch · 等待连接（${state.code}）`
            : 'PeerSwitch 后台服务'
      tray.setToolTip(tip)
    }
  })
  session.on('log', (line) => broadcast('log', line))
  session.on('switch-result', (r) => broadcast('switch-result', r))
  session.on('file-progress', (p) => broadcast('file-progress', p))
  session.on('file-done', (p) => broadcast('file-done', p))
  session.on('file-offer', (p) => broadcast('file-offer', p))
}

function registerIpc(): void {
  ipcMain.handle('settings:get', () => getSettings())
  ipcMain.handle('settings:update', (_e, patch: Partial<PeerSwitchSettings>) => {
    const next = updateSettings(patch)
    if (patch.hotkey) registerHotkey()
    if (typeof patch.openAtLogin === 'boolean') applyOpenAtLogin(patch.openAtLogin)
    return next
  })
  ipcMain.handle('inputs:common', () => COMMON_INPUTS)

  ipcMain.handle('host:start', async () => {
    return session.startHost(DEFAULT_PAIR_CODE)
  })
  ipcMain.handle('host:join', async (_e, host: string, code: string) => {
    const pair = code && /^\d{6}$/.test(code) ? code : DEFAULT_PAIR_CODE
    updateSettings({ lastHost: host, lastCode: pair, lastRole: 'client' })
    await session.join(host, pair)
  })
  ipcMain.handle('host:disconnect', () => {
    session.disconnect()
  })
  ipcMain.handle('host:state', () => session.state)
  ipcMain.handle('lan:scan', async (event) => {
    return scanLanPeers((done, total) => {
      event.sender.send('lan-scan-progress', { done, total })
    })
  })

  ipcMain.handle('switch:now', async () => doSwitch())
  ipcMain.handle('switch:local', async (_e, input: string) => switchMonitorInput(input))

  async function sendPaths(paths: string[]): Promise<string[]> {
    if (session.state.status !== 'connected') {
      broadcast('log', '请先连接对端后再传送文件')
      throw new Error('请先连接对端后再传送文件')
    }
    const ids: string[] = []
    for (const p of paths) {
      ids.push(await session.sendFile(p))
    }
    return ids
  }

  ipcMain.handle('file:send-paths', async (_e, paths: string[]) => {
    broadcast('open-panel', 'files')
    return sendPaths(paths.filter(Boolean))
  })

  ipcMain.handle('file:pick-and-send', async () => {
    showMainWindow()
    broadcast('open-panel', 'files')
    if (session.state.status !== 'connected') {
      broadcast('log', '请先连接对端后再传送文件')
      throw new Error('请先连接对端后再传送文件')
    }
    const res = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openFile', 'multiSelections'],
      title: '选择要发送的文件'
    })
    if (res.canceled || !res.filePaths.length) return []
    return sendPaths(res.filePaths)
  })
  ipcMain.handle('file:accept', async (_e, id: string, name: string, size: number) => {
    await session.acceptFile(id, name, size)
  })
  ipcMain.handle('file:reject', (_e, id: string) => session.rejectFile(id))
  ipcMain.handle('file:open-download-dir', async () => {
    const dir = getSettings().downloadDir
    await shell.openPath(dir)
  })

  ipcMain.handle('autostart:get', () => {
    const login = app.getLoginItemSettings()
    return { openAtLogin: getSettings().openAtLogin, system: login }
  })
  ipcMain.handle('window:show', () => showMainWindow())
}

async function bootstrapService(): Promise<void> {
  const settings = getSettings()
  applyOpenAtLogin(settings.openAtLogin)
  await ensureDownloadDir(settings.downloadDir)

  // 开机自启后默认拉起主机监听，保证对端锁屏/本机锁屏时仍能收切换指令
  try {
    if (settings.autoHost || settings.lastRole === 'host' || !settings.lastRole) {
      await session.startHost(DEFAULT_PAIR_CODE)
    } else if (settings.autoReconnect && settings.lastHost && settings.lastCode) {
      await session.join(settings.lastHost, settings.lastCode || DEFAULT_PAIR_CODE)
    }
  } catch (e) {
    broadcast('log', `后台服务启动：${e instanceof Error ? e.message : String(e)}`)
  }
}

function wirePowerEvents(): void {
  // 锁屏/屏保/睡眠唤醒后，重新确保监听与热键（进程本身继续跑）
  const resume = (): void => {
    registerHotkey()
    void session.ensureListening()
    broadcast('log', '系统已解锁/唤醒，后台切换服务已恢复')
  }
  powerMonitor.on('unlock-screen', resume)
  powerMonitor.on('resume', resume)
  powerMonitor.on('lock-screen', () => {
    broadcast('log', '检测到锁屏：后台服务继续监听切换指令')
  })
  powerMonitor.on('suspend', () => {
    broadcast('log', '系统即将睡眠')
  })
}

app.whenReady().then(async () => {
  if (process.platform === 'win32') app.setAppUserModelId('app.peerswitch.desktop')

  Menu.setApplicationMenu(null)
  registerIpc()
  wireSessionEvents()
  wirePowerEvents()
  createWindow()
  buildTray()
  registerHotkey()
  await bootstrapService()

  app.on('activate', () => {
    showMainWindow()
  })
})

app.on('before-quit', () => {
  isQuitting = true
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  session.disconnect()
})

app.on('window-all-closed', () => {
  // 保持托盘后台，不因关窗退出
  if (!getSettings().closeToTray && process.platform !== 'darwin') {
    app.quit()
  }
})
