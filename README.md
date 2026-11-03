# PeerSwitch

双机共用一台显示器时，用 DDC/CI 切换信号源。支持快捷键、传文件、开机自启。

## 功能

- 默认配对码 `666666`；可扫描局域网加入
- 配对后记住身份，局域网内自动发现重连
- 全局快捷键切屏；托盘常驻；局域网传文件

## 开发

```bash
cd peerswitch
npm install
npm run dev
```

macOS 切屏建议：`brew install m1ddc`

## 打包

```bash
bash scripts/build-dmg.sh   # macOS DMG
bash scripts/build-exe.sh   # Windows EXE
```

产物在 `release/`。

## 使用

1. 两台电脑接到显示器不同输入口，开启 DDC/CI。
2. 两边安装 PeerSwitch：一台创建连接，另一台加入。
3. 设置好本机/对端输入口，用按钮或快捷键切换。
