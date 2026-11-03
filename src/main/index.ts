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
import {
  forgetPairing,
  getSettings,
  updateSettings,
  type PeerSwitchSettings
} from './store'
import { session } from './network'
import { COMMON_INPUTS, ensureDownloadDir, switchMonitorInput } from './ddc'
import { applyOpenAtLogin, isBackgroundLaunch } from './autostart'
import { DEFAULT_PAIR_CODE, scanLanPeers } from './lan-scan'
import {
  applyShellIntegration,
  contextMenuGuideText,
  extractSendFiles,
  openContextMenuSettings
} from './shell-integration'
import { store } from './store'

const isDev = !app.isPackaged

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false
let appReady = false
const pendingSendFiles: string[] = []

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', (_e, argv) => {
    void handleExternalSend(extractSendFiles(argv))
  })
}

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

async function sendFilePaths(paths: string[]): Promise<void> {
  const list = paths.filter(Boolean)
  if (!list.length) return
  broadcast('open-panel', 'files')
  if (session.state.status !== 'connected') {
    broadcast('log', '请先连接对端后再传送文件')
    notify('PeerSwitch', '请先连接对端后再传送文件')
    showMainWindow()
    return
  }
  let ok = 0
  for (const p of list) {
    try {
      await session.sendFile(p)
      ok += 1
    } catch (e) {
      broadcast('log', e instanceof Error ? e.message : String(e))
    }
  }
  if (ok > 0) {
    broadcast('log', `已发送 ${ok} 个文件`)
    notify('PeerSwitch', `已发送 ${ok} 个文件`)
  }
}

async function handleExternalSend(paths: string[]): Promise<void> {
  const list = paths.filter(Boolean)
  if (!list.length) return
  if (!appReady) {
    pendingSendFiles.push(...list)
    return
  }
  await sendFilePaths(list)
}

async function doSendFiles(): Promise<void> {
  if (session.state.status !== 'connected') {
    broadcast('log', '请先连接对端后再传送文件')
    notify('PeerSwitch', '请先连接对端后再传送文件')
    showMainWindow()
    return
  }
  const parent = BrowserWindow.getFocusedWindow() || mainWindow || undefined
  const res = await dialog.showOpenDialog(parent!, {
    properties: ['openFile', 'multiSelections'],
    title: '选择要发送的文件'
  })
  if (res.canceled || !res.filePaths.length) return
  await sendFilePaths(res.filePaths)
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

function trayMenu(): Menu {
  return Menu.buildFromTemplate([
    {
      label: '打开 PeerSwitch',
      click: () => showMainWindow()
    },
    {
      label: '立即切换屏幕',
      click: () => void doSwitch()
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        isQuitting = true
        app.quit()
      }
    }
  ])
}

function refreshTrayMenu(): void {
  tray?.setContextMenu(trayMenu())
}

function buildTray(): void {
  if (tray) return
  let image = nativeImage.createFromPath(iconPath())
  if (image.isEmpty()) {
    image = nativeImage.createEmpty()
  }
  if (process.platform === 'darwin') {
    image = image.resize({ width: 18, height: 18 })
  } else {
    image = image.resize({ width: 16, height: 16 })
  }

  tray = new Tray(image)
  tray.setToolTip('PeerSwitch')
  tray.setContextMenu(trayMenu())
  tray.on('click', () => {
    if (process.platform === 'darwin') {
      tray?.popUpContextMenu()
    } else {
      showMainWindow()
    }
  })
  tray.on('double-click', () => showMainWindow())
}

function wireSessionEvents(): void {
  session.on('state', (state) => {
    broadcast('conn-state', state)
    refreshTrayMenu()
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
  ipcMain.handle('settings:update', async (_e, patch: Partial<PeerSwitchSettings>) => {
    const next = updateSettings(patch)
    if (patch.hotkey) registerHotkey()
    if (typeof patch.openAtLogin === 'boolean') applyOpenAtLogin(patch.openAtLogin)
    if (typeof patch.contextMenuSend === 'boolean') {
      try {
        await applyShellIntegration(patch.contextMenuSend)
        if (patch.contextMenuSend) {
          await showContextMenuGuide(true)
        }
      } catch (e) {
        broadcast('log', e instanceof Error ? e.message : String(e))
      }
    }
    return next
  })
  ipcMain.handle('inputs:common', () => COMMON_INPUTS)

  ipcMain.handle('host:start', async () => {
    return session.startHost(DEFAULT_PAIR_CODE)
  })
  ipcMain.handle('host:join', async (_e, host: string, code: string) => {
    const pair = code && /^\d{6}$/.test(code) ? code : DEFAULT_PAIR_CODE
    await session.join(host, pair)
  })
  ipcMain.handle('host:disconnect', () => {
    // 普通断开：保留配对，后台继续自动重连
    session.disconnect(false)
  })
  ipcMain.handle('host:forget', () => {
    session.disconnect(true)
    return forgetPairing()
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
  ipcMain.handle('shell:open-context-settings', () => openContextMenuSettings())
  ipcMain.handle('shell:show-context-guide', () => showContextMenuGuide(true))
}

async function showContextMenuGuide(force = false): Promise<void> {
  if (!getSettings().contextMenuSend) return
  if (!force && store.get('__context_menu_guide_v1')) return

  showMainWindow()
  const { title, detail } = contextMenuGuideText()
  // 默认「知道了」，避免一启动就丢进系统设置
  const buttons =
    process.platform === 'darwin' ? ['知道了', '打开键盘快捷键…'] : ['知道了']
  const result = await dialog.showMessageBox(mainWindow ?? undefined!, {
    type: 'info',
    title: 'PeerSwitch',
    message: title,
    detail,
    buttons,
    defaultId: 0,
    cancelId: 0,
    noLink: true
  })
  store.set('__context_menu_guide_v1', true)
  if (process.platform === 'darwin' && result.response === 1) {
    await openContextMenuSettings()
  }
}

async function bootstrapService(): Promise<void> {
  const settings = getSettings()
  applyOpenAtLogin(settings.openAtLogin)
  await ensureDownloadDir(settings.downloadDir)

  try {
    await applyShellIntegration(settings.contextMenuSend)
  } catch (e) {
    broadcast('log', e instanceof Error ? e.message : String(e))
  }

  // 始终监听 + 局域网广播发现；两边 IP 变了也能靠 pairId 自动重连
  try {
    await session.startHost(DEFAULT_PAIR_CODE)
    if (settings.autoReconnect && (settings.pairId || settings.lastHost)) {
      broadcast('log', '正在寻找对端…')
      session.scheduleReconnect('启动')
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
  }
  powerMonitor.on('unlock-screen', resume)
  powerMonitor.on('resume', resume)
}

app.whenReady().then(async () => {
  if (!gotLock) return
  if (process.platform === 'win32') app.setAppUserModelId('app.peerswitch.desktop')

  Menu.setApplicationMenu(null)
  registerIpc()
  wireSessionEvents()
  wirePowerEvents()
  createWindow()
  buildTray()
  registerHotkey()
  await bootstrapService()
  appReady = true

  const fromArgv = extractSendFiles(process.argv)
  const queued = [...pendingSendFiles, ...fromArgv]
  pendingSendFiles.length = 0
  if (queued.length) void handleExternalSend(queued)

  // 首次启动提示如何启用右键传送（macOS 需在系统设置里勾选）
  void showContextMenuGuide(false)

  app.on('activate', () => {
    showMainWindow()
  })
})

app.on('before-quit', () => {
  isQuitting = true
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  session.shutdown()
})

app.on('window-all-closed', () => {
  // 保持托盘后台，不因关窗退出
  if (!getSettings().closeToTray && process.platform !== 'darwin') {
    app.quit()
  }
})
