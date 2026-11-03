import { app, shell } from 'electron'
import { execFile } from 'child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

const MAC_SERVICE = '传送至对端'
const WIN_MENU = '传送至对端'
const WIN_KEY_STAR = 'HKCU\\Software\\Classes\\*\\shell\\PeerSwitchSend'
const WIN_KEY_DIR = 'HKCU\\Software\\Classes\\Directory\\shell\\PeerSwitchSend'

export type LaunchSpec = {
  bin: string
  prefixArgs: string[]
}

/** 解析命令行里的 --send-files 路径 */
export function extractSendFiles(argv: string[]): string[] {
  const idx = argv.findIndex((a) => a === '--send-files')
  if (idx < 0) return []
  return argv.slice(idx + 1).filter((a) => Boolean(a) && !a.startsWith('-') && a !== '.')
}

export function getLaunchSpec(): LaunchSpec {
  if (app.isPackaged) {
    return { bin: process.execPath, prefixArgs: [] }
  }
  // 开发模式：Electron 二进制 + 应用路径
  return { bin: process.execPath, prefixArgs: [app.getAppPath()] }
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16).toUpperCase()
  })
}

function macWorkflowDir(): string {
  return join(homedir(), 'Library', 'Services', `${MAC_SERVICE}.workflow`)
}

function buildMacShellCommand(spec: LaunchSpec): string {
  const parts = [shellQuote(spec.bin), ...spec.prefixArgs.map(shellQuote), '--send-files', '"$@"']
  return `${parts.join(' ')} &>/dev/null &`
}

function buildMacInfoPlist(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleIdentifier</key>
	<string>app.peerswitch.send-to-peer</string>
	<key>CFBundleName</key>
	<string>${MAC_SERVICE}</string>
	<key>CFBundleShortVersionString</key>
	<string>1.0</string>
	<key>CFBundleVersion</key>
	<string>1</string>
	<key>NSServices</key>
	<array>
		<dict>
			<key>NSBackgroundColorName</key>
			<string>background</string>
			<key>NSIconName</key>
			<string>NSShareTemplate</string>
			<key>NSMenuItem</key>
			<dict>
				<key>default</key>
				<string>${MAC_SERVICE}</string>
			</dict>
			<key>NSMessage</key>
			<string>runWorkflowAsService</string>
			<key>NSRequiredContext</key>
			<dict>
				<key>NSApplicationIdentifier</key>
				<string>com.apple.finder</string>
			</dict>
			<key>NSSendFileTypes</key>
			<array>
				<string>public.item</string>
			</array>
		</dict>
	</array>
</dict>
</plist>
`
}

function buildMacDocumentWflow(shellCmd: string): string {
  const actionId = uuid()
  const escaped = shellCmd
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>AMApplicationBuild</key>
	<string>523</string>
	<key>AMApplicationVersion</key>
	<string>2.10</string>
	<key>AMDocumentVersion</key>
	<string>2</string>
	<key>actions</key>
	<array>
		<dict>
			<key>action</key>
			<dict>
				<key>AMAccepts</key>
				<dict>
					<key>Container</key>
					<string>List</string>
					<key>Optional</key>
					<true/>
					<key>Types</key>
					<array>
						<string>com.apple.cocoa.path</string>
					</array>
				</dict>
				<key>AMActionVersion</key>
				<string>2.0.3</string>
				<key>AMApplication</key>
				<array>
					<string>Automator</string>
				</array>
				<key>AMParameterProperties</key>
				<dict>
					<key>COMMAND_STRING</key>
					<dict/>
					<key>CheckedForUserDefaultShell</key>
					<dict/>
					<key>inputMethod</key>
					<dict/>
					<key>shell</key>
					<dict/>
					<key>source</key>
					<dict/>
				</dict>
				<key>AMProvides</key>
				<dict>
					<key>Container</key>
					<string>List</string>
					<key>Types</key>
					<array>
						<string>com.apple.cocoa.path</string>
					</array>
				</dict>
				<key>ActionBundlePath</key>
				<string>/System/Library/Automator/Run Shell Script.action</string>
				<key>ActionName</key>
				<string>Run Shell Script</string>
				<key>ActionParameters</key>
				<dict>
					<key>COMMAND_STRING</key>
					<string>${escaped}</string>
					<key>CheckedForUserDefaultShell</key>
					<true/>
					<key>inputMethod</key>
					<integer>1</integer>
					<key>shell</key>
					<string>/bin/zsh</string>
					<key>source</key>
					<string></string>
				</dict>
				<key>BundleIdentifier</key>
				<string>com.apple.RunShellScript</string>
				<key>CFBundleVersion</key>
				<string>2.0.3</string>
				<key>CanShowSelectedItemsWhenRun</key>
				<false/>
				<key>CanShowWhenRun</key>
				<true/>
				<key>Category</key>
				<array>
					<string>AMCategoryUtilities</string>
				</array>
				<key>Class Name</key>
				<string>RunShellScriptAction</string>
				<key>InputUUID</key>
				<string>${uuid()}</string>
				<key>Keywords</key>
				<array>
					<string>Shell</string>
					<string>Script</string>
					<string>Command</string>
					<string>Run</string>
					<string>Unix</string>
				</array>
				<key>OutputUUID</key>
				<string>${uuid()}</string>
				<key>UUID</key>
				<string>${actionId}</string>
				<key>UnlocalizedApplications</key>
				<array>
					<string>Automator</string>
				</array>
				<key>keywords</key>
				<array>
					<string>Shell</string>
					<string>Script</string>
					<string>Command</string>
					<string>Run</string>
					<string>Unix</string>
				</array>
			</dict>
			<key>isViewVisible</key>
			<integer>1</integer>
		</dict>
	</array>
	<key>connectors</key>
	<dict/>
	<key>workflowMetaData</key>
	<dict>
		<key>serviceApplicationBundleID</key>
		<string>com.apple.finder</string>
		<key>serviceApplicationPath</key>
		<string>/System/Library/CoreServices/Finder.app</string>
		<key>serviceInputTypeIdentifier</key>
		<string>com.apple.Automator.fileSystemObject</string>
		<key>serviceOutputTypeIdentifier</key>
		<string>com.apple.Automator.nothing</string>
		<key>serviceProcessesInput</key>
		<integer>0</integer>
		<key>workflowTypeIdentifier</key>
		<string>com.apple.Automator.services.quickaction</string>
	</dict>
</dict>
</plist>
`
}

async function flushMacServices(): Promise<void> {
  try {
    await execFileAsync('/System/Library/CoreServices/pbs', ['-flush'])
  } catch {
    /* ignore */
  }
  try {
    await execFileAsync('/System/Library/CoreServices/pbs', ['-update'])
  } catch {
    /* ignore */
  }
}

async function installMac(): Promise<void> {
  const spec = getLaunchSpec()
  const root = macWorkflowDir()
  const contents = join(root, 'Contents')
  rmSync(root, { recursive: true, force: true })
  mkdirSync(contents, { recursive: true })
  writeFileSync(join(contents, 'Info.plist'), buildMacInfoPlist(), 'utf8')
  writeFileSync(join(contents, 'document.wflow'), buildMacDocumentWflow(buildMacShellCommand(spec)), 'utf8')
  await flushMacServices()
}

async function uninstallMac(): Promise<void> {
  rmSync(macWorkflowDir(), { recursive: true, force: true })
  await flushMacServices()
}

function winCommandLine(spec: LaunchSpec): string {
  const parts = [`"${spec.bin}"`, ...spec.prefixArgs.map((a) => `"${a}"`), '--send-files', '"%1"']
  return parts.join(' ')
}

async function regAdd(key: string, args: string[]): Promise<void> {
  await execFileAsync('reg', ['add', key, ...args, '/f'])
}

async function regDelete(key: string): Promise<void> {
  try {
    await execFileAsync('reg', ['delete', key, '/f'])
  } catch {
    /* ignore */
  }
}

async function installWin(): Promise<void> {
  const spec = getLaunchSpec()
  const cmd = winCommandLine(spec)
  const icon = spec.bin

  for (const key of [WIN_KEY_STAR, WIN_KEY_DIR]) {
    await regAdd(key, ['/ve', '/d', WIN_MENU])
    await regAdd(key, ['/v', 'Icon', '/d', icon])
    await regAdd(key, ['/v', 'MultiSelectModel', '/d', 'Document'])
    await regAdd(`${key}\\command`, ['/ve', '/d', cmd])
  }
}

async function uninstallWin(): Promise<void> {
  await regDelete(WIN_KEY_STAR)
  await regDelete(WIN_KEY_DIR)
}

export async function applyShellIntegration(enabled: boolean): Promise<void> {
  if (process.platform === 'darwin') {
    if (enabled) await installMac()
    else await uninstallMac()
    return
  }
  if (process.platform === 'win32') {
    if (enabled) await installWin()
    else await uninstallWin()
  }
}

export function shellIntegrationInstalled(): boolean {
  if (process.platform === 'darwin') {
    return existsSync(macWorkflowDir())
  }
  return false
}

/**
 * 直接打开「键盘快捷键」面板，并选中左侧「快速操作 / 服务」。
 * 目标是让用户勾选「传送至对端」，不要停在键盘设置首页。
 */
export async function openContextMenuSettings(): Promise<void> {
  if (process.platform !== 'darwin') return

  // 优先走 Shortcuts 深链，尽量别落在键盘首页
  const deepLinks = [
    'x-apple.systempreferences:com.apple.Keyboard-Settings.extension?Shortcuts',
    'x-apple.systempreferences:com.apple.preference.keyboard?Shortcuts'
  ]
  for (const url of deepLinks) {
    try {
      await shell.openExternal(url)
      break
    } catch {
      /* try next */
    }
  }

  const script = `
on clickNamedButton(proc, names)
  tell process proc
    set frontmost to true
    repeat with nm in names
      try
        click (first button whose name contains (nm as text)) of window 1
        return true
      end try
      try
        repeat with g in groups of window 1
          try
            click (first button whose name contains (nm as text)) of g
            return true
          end try
          try
            repeat with g2 in groups of g
              try
                click (first button whose name contains (nm as text)) of g2
                return true
              end try
            end repeat
          end try
        end repeat
      end try
    end repeat
  end tell
  return false
end clickNamedButton

on clickNamedRow(proc, names)
  tell process proc
    set frontmost to true
    repeat with nm in names
      set target to nm as text
      -- outline / table / static text
      try
        click (first UI element whose name is target) of window 1
        return true
      end try
      try
        repeat with w in windows
          try
            click (first UI element whose name is target) of w
            return true
          end try
          try
            click (first static text whose value is target) of w
            return true
          end try
          try
            click (first row whose name is target) of outline 1 of scroll area 1 of splitter group 1 of w
            return true
          end try
          try
            click (first row whose name is target) of table 1 of scroll area 1 of splitter group 1 of w
            return true
          end try
        end repeat
      end try
    end repeat
  end tell
  return false
end clickNamedRow

tell application "System Settings" to activate
delay 0.6

tell application "System Events"
  -- 若还在键盘首页，点「键盘快捷键…」进入面板
  my clickNamedButton("System Settings", {"键盘快捷键", "Keyboard Shortcuts"})
  delay 0.8
  -- 左侧优先「快速操作」，再「服务」
  if not my clickNamedRow("System Settings", {"快速操作", "Quick Actions"}) then
    my clickNamedRow("System Settings", {"服务", "Services"})
  end if
end tell
`
  try {
    await execFileAsync('osascript', ['-e', script])
  } catch {
    /* 无辅助功能权限时，至少已尝试打开 Shortcuts 深链 */
  }
}

export function contextMenuGuideText(): { title: string; detail: string } {
  if (process.platform === 'darwin') {
    return {
      title: '勾选「传送至对端」',
      detail:
        '已安装访达右键项。请在打开的快捷键面板左侧选择「快速操作」或「服务」，勾选「传送至对端」。'
    }
  }
  return {
    title: '右键「传送至对端」',
    detail: '已写入资源管理器右键菜单，选中文件即可看到。'
  }
}
