# PeerSwitch

双机共用一台显示器时，用 DDC/CI **切换信号源**。支持快捷键、传文件、开机自启后台服务；对端锁屏/屏保时仍可切换。

## 功能

- 默认配对码 `666666`；可扫描局域网开放端口并点选 IP 加入
- 配对后记住身份（pairId）+ 局域网 UDP 广播发现，两边 IP 变化也能自动重连
- 右上角：**切换** / **传送文件** / **设置**
- 全局快捷键（默认 macOS `⌘⌥Q`，Windows `Ctrl+Alt+Q`）
- DDC/CI（VCP `0x60`）切屏，画面原生直出
- **开机自启 + 托盘常驻**：关窗口不退出；锁屏/唤醒后继续监听
- 局域网传文件

## 开发

```bash
cd peerswitch
npm install
npm run dev
```

macOS 切屏建议：`brew install m1ddc`

## 一键打包

```bash
bash scripts/build-dmg.sh   # macOS DMG
bash scripts/build-exe.sh   # Windows EXE
```

产物在 `release/`。

## 使用说明

1. 两台电脑分别接到显示器不同输入口（HDMI / DP / USB-C）。
2. 显示器 OSD 中开启 **DDC/CI**。
3. 两边安装 PeerSwitch → 一台「创建连接」，另一台用 IP + 配对码「加入」。
4. 在设置里选好本机/对端输入口，点切换或按快捷键。
5. 保持「开机自动启动后台服务」开启，这样锁屏时对端仍能把画面切过来。
