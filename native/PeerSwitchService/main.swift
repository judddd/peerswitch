import AppKit

final class ServiceProvider: NSObject {
  @objc func sendToPeer(
    _ pboard: NSPasteboard,
    userData: String?,
    error: AutoreleasingUnsafeMutablePointer<NSString?>
  ) {
    var paths: [String] = []
    if let list = pboard.propertyList(forType: .init("NSFilenamesPboardType")) as? [String] {
      paths.append(contentsOf: list)
    }
    if paths.isEmpty, let urls = pboard.readObjects(forClasses: [NSURL.self], options: [
      .urlReadingFileURLsOnly: true
    ]) as? [URL] {
      paths.append(contentsOf: urls.map(\.path))
    }
    paths = paths.filter { !$0.isEmpty }
    guard !paths.isEmpty else { return }

    let bin = peerSwitchBinary()
    guard FileManager.default.isExecutableFile(atPath: bin) else { return }

    let proc = Process()
    proc.executableURL = URL(fileURLWithPath: bin)
    proc.arguments = ["--send-files"] + paths
    proc.standardOutput = FileHandle.nullDevice
    proc.standardError = FileHandle.nullDevice
    do {
      try proc.run()
    } catch {
      /* ignore */
    }
  }
}

func peerSwitchBinary() -> String {
  if let env = ProcessInfo.processInfo.environment["PEERSWITCH_BIN"], !env.isEmpty {
    return env
  }
  // .../PeerSwitch.app/Contents/Resources/PeerSwitchService.app
  // → .../PeerSwitch.app/Contents/MacOS/PeerSwitch
  let helperApp = Bundle.main.bundleURL
  let contents = helperApp.deletingLastPathComponent().deletingLastPathComponent()
  return contents.appendingPathComponent("MacOS/PeerSwitch").path
}

let provider = ServiceProvider()
let app = NSApplication.shared
app.setActivationPolicy(.accessory)
app.servicesProvider = provider
NSUpdateDynamicServices()
app.run()
