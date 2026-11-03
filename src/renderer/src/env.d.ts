import type { PeerSwitchApi } from '../../preload/index'

declare global {
  interface Window {
    peerswitch: PeerSwitchApi
  }
}

export {}
