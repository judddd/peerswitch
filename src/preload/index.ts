import { contextBridge, ipcRenderer } from 'electron'

export type ConnState =
  | { status: 'idle' }
  | { status: 'hosting'; code: string; port: number }
  | { status: 'connecting' }
  | {
      status: 'connected'
      peerName: string
      role: 'host' | 'client'
      remoteAddress: string
    }

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
  autoReconnect: boolean
  closeToTray: boolean
  lastHost: string
  lastCode: string
  lastRole: 'host' | 'client' | ''
}

const api = {
  getSettings: (): Promise<PeerSwitchSettings> => ipcRenderer.invoke('settings:get'),
  updateSettings: (patch: Partial<PeerSwitchSettings>): Promise<PeerSwitchSettings> =>
    ipcRenderer.invoke('settings:update', patch),
  commonInputs: (): Promise<{ label: string; value: string }[]> =>
    ipcRenderer.invoke('inputs:common'),

  startHost: (): Promise<{ code: string; port: number }> => ipcRenderer.invoke('host:start'),
  join: (host: string, code: string): Promise<void> => ipcRenderer.invoke('host:join', host, code),
  disconnect: (): Promise<void> => ipcRenderer.invoke('host:disconnect'),
  getState: (): Promise<ConnState> => ipcRenderer.invoke('host:state'),

  switchNow: (): Promise<{ ok: boolean; detail: string }> => ipcRenderer.invoke('switch:now'),
  switchLocal: (input: string): Promise<{ ok: boolean; detail: string; code: number }> =>
    ipcRenderer.invoke('switch:local', input),

  pickAndSendFiles: (): Promise<string[]> => ipcRenderer.invoke('file:pick-and-send'),
  acceptFile: (id: string, name: string, size: number): Promise<void> =>
    ipcRenderer.invoke('file:accept', id, name, size),
  rejectFile: (id: string): Promise<void> => ipcRenderer.invoke('file:reject', id),
  openDownloadDir: (): Promise<void> => ipcRenderer.invoke('file:open-download-dir'),

  on: (channel: string, cb: (payload: unknown) => void): (() => void) => {
    const listener = (_: Electron.IpcRendererEvent, payload: unknown): void => cb(payload)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  }
}

contextBridge.exposeInMainWorld('peerswitch', api)

export type PeerSwitchApi = typeof api
