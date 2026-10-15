#!/bin/bash
# 双击运行：自动准备环境、构建 lingdot-desktop-pet（小喵桌宠），并把 .dmg 和浏览器扩展放到桌面。
set -e
cd "$(dirname "$0")"
say() { printf "\n\033[1;35m[小喵]\033[0m %s\n" "$1"; }

# 连不上官方源时自动用国内镜像
if ! curl -fsS --max-time 8 https://static.rust-lang.org/dist/channel-rust-stable.toml.sha256 >/dev/null 2>&1; then
  export RUSTUP_DIST_SERVER="https://rsproxy.cn" RUSTUP_UPDATE_ROOT="https://rsproxy.cn/rustup"
  export NVM_NODEJS_ORG_MIRROR="https://npmmirror.com/mirrors/node" npm_config_registry="https://registry.npmmirror.com"
  mkdir -p ~/.cargo
  [ -f ~/.cargo/config.toml ] || printf '[source.crates-io]\nreplace-with = "rsproxy-sparse"\n\n[source.rsproxy-sparse]\nregistry = "sparse+https://rsproxy.cn/index/"\n' > ~/.cargo/config.toml
  RUSTUP_INIT_URL="https://rsproxy.cn/rustup-init.sh"
fi
say "哼，本猫开始帮你装了，不要乱动电脑哦……喵"

# 1. Xcode 命令行工具
if ! xcode-select -p >/dev/null 2>&1; then
  say "需要先装苹果的开发工具。会弹出一个窗口，点「安装」，装完后再双击我一次。"
  xcode-select --install || true
  read -n 1 -s -r -p "按任意键关闭……"; exit 0
fi

# 2. Node.js（用 nvm，免管理员密码）
export NVM_DIR="$HOME/.nvm"
if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  say "安装 Node.js……"
  [ -s "$NVM_DIR/nvm.sh" ] || curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
  . "$NVM_DIR/nvm.sh"; nvm install 22; nvm use 22
fi
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null 2>&1 || true

# 3. pnpm
command -v pnpm >/dev/null 2>&1 || { say "安装 pnpm……"; npm install -g pnpm@10; }

# 4. Rust
if ! command -v cargo >/dev/null 2>&1; then
  say "安装 Rust……（第一次比较慢）"
  curl --proto '=https' --tlsv1.2 -sSf "${RUSTUP_INIT_URL:-https://sh.rustup.rs}" | sh -s -- -y
fi
. "$HOME/.cargo/env"

# 5. 构建
say "安装依赖……"
pnpm install
say "构建浏览器扩展……"
pnpm --filter @desktop-pet/browser-extension build
say "构建桌宠 App……（大概 5 到 15 分钟，去喝口水吧，笨蛋）"
pnpm --filter @desktop-pet/desktop tauri build

# 6. 放到桌面
DMG=$(ls apps/desktop/src-tauri/target/release/bundle/dmg/*.dmg | head -1)
OUT="$HOME/Desktop/lingdot-desktop-pet"
mkdir -p "$OUT"
cp "$DMG" "$OUT/"
rm -rf "$OUT/浏览器扩展"; cp -R apps/browser-extension/dist "$OUT/浏览器扩展"
say "好了！桌面上的「lingdot-desktop-pet」文件夹里有安装包和浏览器扩展。才、才不是特意为你做的呢……喵"
open "$OUT"
open "$OUT/$(basename "$DMG")"
read -n 1 -s -r -p "按任意键关闭……"
