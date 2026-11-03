import { execFile } from 'child_process'
import { promisify } from 'util'
import { existsSync, unlinkSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import { writeFile, mkdir } from 'fs/promises'
import { tmpdir } from 'os'

const execFileAsync = promisify(execFile)

function resourceDdcDir(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'ddc')
  }
  return join(app.getAppPath(), 'native', 'bin')
}

function parseInputCode(raw: string): number {
  const t = raw.trim().toLowerCase()
  if (t.startsWith('0x')) return parseInt(t, 16)
  const n = Number(t)
  if (!Number.isFinite(n)) throw new Error(`无效的输入源代码：${raw}`)
  return n
}

function macPathEnv(): NodeJS.ProcessEnv {
  const extra = ['/opt/homebrew/bin', '/usr/local/bin', '/opt/homebrew/sbin', '/usr/local/sbin']
  const path = [extra.join(':'), process.env.PATH || ''].filter(Boolean).join(':')
  return { ...process.env, PATH: path }
}

async function run(cmd: string, args: string[]): Promise<string> {
  const { stdout, stderr } = await execFileAsync(cmd, args, {
    timeout: 4000,
    windowsHide: true,
    env: process.platform === 'darwin' ? macPathEnv() : process.env
  })
  return `${stdout || ''}${stderr || ''}`.trim()
}

async function switchWindows(inputCode: number): Promise<{ ok: boolean; detail: string }> {
  const script = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class PeerSwitchDdc {
  [DllImport("dxva2.dll", SetLastError=true)]
  public static extern bool GetNumberOfPhysicalMonitorsFromHMONITOR(IntPtr hMonitor, ref uint pdwNumberOfPhysicalMonitors);
  [DllImport("dxva2.dll", SetLastError=true)]
  public static extern bool GetPhysicalMonitorsFromHMONITOR(IntPtr hMonitor, uint dwPhysicalMonitorArraySize, [Out] PHYSICAL_MONITOR[] pPhysicalMonitorArray);
  [DllImport("dxva2.dll", SetLastError=true)]
  public static extern bool SetVCPFeature(IntPtr hMonitor, byte bVCPCode, uint dwNewValue);
  [DllImport("dxva2.dll", SetLastError=true)]
  public static extern bool DestroyPhysicalMonitors(uint dwPhysicalMonitorArraySize, PHYSICAL_MONITOR[] pPhysicalMonitorArray);
  [DllImport("user32.dll")]
  public static extern bool EnumDisplayMonitors(IntPtr hdc, IntPtr lprcClip, MonitorEnumProc lpfnEnum, IntPtr dwData);
  public delegate bool MonitorEnumProc(IntPtr hMonitor, IntPtr hdcMonitor, IntPtr lprcMonitor, IntPtr dwData);
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)]
  public struct PHYSICAL_MONITOR {
    public IntPtr hPhysicalMonitor;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)]
    public string szPhysicalMonitorDescription;
  }
  public static int SwitchAll(uint code) {
    int ok = 0;
    MonitorEnumProc cb = (h, a, b, c) => {
      uint count = 0;
      if (!GetNumberOfPhysicalMonitorsFromHMONITOR(h, ref count) || count == 0) return true;
      var arr = new PHYSICAL_MONITOR[count];
      if (!GetPhysicalMonitorsFromHMONITOR(h, count, arr)) return true;
      for (int i = 0; i < count; i++) {
        if (SetVCPFeature(arr[i].hPhysicalMonitor, 0x60, code)) ok++;
      }
      DestroyPhysicalMonitors(count, arr);
      return true;
    };
    EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, cb, IntPtr.Zero);
    return ok;
  }
}
"@
$r = [PeerSwitchDdc]::SwitchAll(${inputCode})
Write-Output "switched=$r"
`
  const file = join(tmpdir(), `peerswitch-ddc-${Date.now()}.ps1`)
  await writeFile(file, script, 'utf8')
  try {
    const out = await run('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      file
    ])
    const m = /switched=(\d+)/.exec(out)
    const n = m ? Number(m[1]) : 0
    return {
      ok: n > 0,
      detail: n > 0 ? `已切换显示器输入源（代码 ${inputCode}）` : out || '显示器未响应 VCP 0x60 指令'
    }
  } finally {
    try {
      unlinkSync(file)
    } catch {
      /* ignore */
    }
  }
}

async function switchMac(inputCode: number): Promise<{ ok: boolean; detail: string }> {
  const dir = resourceDdcDir()
  // 优先用系统 brew 安装的真二进制；打包目录里的壳脚本放最后，失败也继续试下一个
  const candidates = [
    '/opt/homebrew/bin/m1ddc',
    '/usr/local/bin/m1ddc',
    join(dir, 'm1ddc'),
    '/opt/homebrew/bin/ddcctl',
    '/usr/local/bin/ddcctl',
    join(dir, 'ddcctl')
  ]

  const errors: string[] = []

  for (const bin of candidates) {
    if (!existsSync(bin)) continue
    const base = bin.split('/').pop() || ''
    try {
      if (base === 'm1ddc') {
        // m1ddc 使用十进制：DP1=15, HDMI1=17 …
        await run(bin, ['display', '1', 'set', 'input', String(inputCode)])
        return { ok: true, detail: `已通过 m1ddc 切换到输入源 ${inputCode}` }
      }
      if (base === 'ddcctl') {
        await run(bin, ['-d', '1', '-i', String(inputCode)])
        return { ok: true, detail: `已通过 ddcctl 切换到输入源 ${inputCode}` }
      }
    } catch (e) {
      errors.push(`${bin}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  // 最后才试壳脚本（依赖 PATH，GUI 启动时经常找不到 brew）
  for (const wrapper of [join(dir, 'PeerSwitchDDC'), join(dir, 'OrbitDDC')]) {
    if (!existsSync(wrapper)) continue
    try {
      await run(wrapper, ['set', String(inputCode)])
      return { ok: true, detail: `已切换到输入源 ${inputCode}` }
    } catch (e) {
      errors.push(`${wrapper}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const hint = existsSync('/opt/homebrew/bin/m1ddc')
    ? `已检测到 /opt/homebrew/bin/m1ddc，但执行失败。${errors.slice(-2).join('；')}`
    : '未找到可用的 m1ddc。请执行 brew install m1ddc 后完全退出并重开 PeerSwitch。'

  return {
    ok: false,
    detail: `${hint} 切换请求仍会发给对端。`
  }
}

export async function switchMonitorInput(
  inputRaw: string
): Promise<{ ok: boolean; detail: string; code: number }> {
  const code = parseInputCode(inputRaw)
  if (process.platform === 'darwin') {
    const r = await switchMac(code)
    return { ...r, code }
  }
  if (process.platform === 'win32') {
    const r = await switchWindows(code)
    return { ...r, code }
  }
  return { ok: false, detail: '仅支持 macOS 与 Windows 的 DDC 切换', code }
}

export async function ensureDownloadDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true })
}

export const COMMON_INPUTS = [
  { label: 'DisplayPort 1', value: '0x0F' },
  { label: 'DisplayPort 2', value: '0x10' },
  { label: 'HDMI 1', value: '0x11' },
  { label: 'HDMI 2', value: '0x12' },
  { label: 'USB-C / 雷电', value: '0x1B' },
  { label: 'DVI 1', value: '0x03' }
]
