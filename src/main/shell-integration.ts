import { app } from 'electron'
import { execFile, execFileSync, spawn } from 'child_process'
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
			<key>NSSendFileTypes</key>
			<array>
				<string>public.item</string>
				<string>public.directory</string>
			</array>
			<key>NSSendTypes</key>
			<array>
				<string>NSFilenamesPboardType</string>
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
		<string>com.apple.Automator.services</string>
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

function finderServiceApp(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'PeerSwitchService.app')
  }
  return join(app.getAppPath(), 'native/bin/PeerSwitchService.app')
}

async function enablePbsContextMenu(bundleId: string, menu: string): Promise<void> {
  const key = `${bundleId} - ${menu}`
  try {
    await execFileAsync('defaults', [
      'write',
      'pbs',
      'NSServicesStatus',
      '-dict-add',
      key,
      '{ enabled_context_menu = 1; enabled_services_menu = 1; }'
    ])
  } catch {
    /* ignore */
  }
}

function startFinderServiceHelper(): void {
  if (process.platform !== 'darwin') return
  const helperApp = finderServiceApp()
  if (!existsSync(helperApp)) return
  try {
    execFileSync('/usr/bin/pkill', ['-x', 'PeerSwitchService'], { stdio: 'ignore' })
  } catch {
    /* 没有旧进程 */
  }
  spawn('/usr/bin/open', ['-g', helperApp], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, PEERSWITCH_BIN: getLaunchSpec().bin }
  }).unref()
}

export function stopFinderServiceHelper(): void {
  try {
    execFileSync('/usr/bin/pkill', ['-x', 'PeerSwitchService'], { stdio: 'ignore' })
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
  try {
    await execFileAsync('xattr', ['-cr', root])
  } catch {
    /* ignore */
  }
  startFinderServiceHelper()
  const helperApp = finderServiceApp()
  if (existsSync(helperApp)) {
    try {
      const lsregister =
        '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister'
      await execFileAsync(lsregister, ['-f', helperApp])
    } catch {
      /* ignore */
    }
  }
  await enablePbsContextMenu('app.peerswitch.service', MAC_SERVICE)
  await enablePbsContextMenu('app.peerswitch.send-to-peer', MAC_SERVICE)
  await flushMacServices()
}

async function uninstallMac(): Promise<void> {
  stopFinderServiceHelper()
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

export async function openContextMenuSettings(): Promise<void> {
  if (process.platform !== 'darwin') return
  await applyShellIntegration(true)
}

export function contextMenuGuideText(): { title: string; detail: string } {
  if (process.platform === 'darwin') {
    return {
      title: '访达右键「传送至对端」',
      detail:
        '已启用。在访达中选中文件，右键即可看到「传送至对端」。\n若在底部「服务」子菜单里，点一下即可。'
    }
  }
  return {
    title: '右键「传送至对端」',
    detail: '已写入资源管理器右键菜单，选中文件即可看到。'
  }
}
