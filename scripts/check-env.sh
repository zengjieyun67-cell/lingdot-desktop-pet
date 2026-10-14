#!/usr/bin/env bash
# 检查在 macOS 上构建「桌面智能桌宠」所需的环境，并为缺失项打印确切的安装命令。
# 用法：bash scripts/check-env.sh
set -u

ok()   { printf "  \033[32m✔\033[0m %s\n" "$1"; }
bad()  { printf "  \033[31m✘\033[0m %s\n" "$1"; MISSING=$((MISSING+1)); }
warn() { printf "  \033[33m!\033[0m %s\n" "$1"; }
fix()  { printf "      \033[36m→ %s\033[0m\n" "$1"; }
MISSING=0

echo "== 桌面智能桌宠 · 环境检查 =="

# ---- OS
OS="$(uname -s)"
if [ "$OS" = "Darwin" ]; then
  VER="$(sw_vers -productVersion 2>/dev/null || echo '?')"
  ARCH="$(uname -m)"
  MAJOR="${VER%%.*}"
  if [ "${MAJOR:-0}" -ge 11 ] 2>/dev/null; then ok "macOS $VER ($ARCH)"; else bad "macOS $VER：需要 macOS 11 (Big Sur) 或更新"; fi
else
  warn "当前系统是 $OS：.app / .dmg 只能在 macOS 上打包（其余步骤可用于开发/测试）"
fi

# ---- Xcode Command Line Tools
if [ "$OS" = "Darwin" ]; then
  if xcode-select -p >/dev/null 2>&1; then ok "Xcode Command Line Tools：$(xcode-select -p)"; else
    bad "未安装 Xcode Command Line Tools"; fix "xcode-select --install"; fi
fi

# ---- Rust
if command -v rustc >/dev/null 2>&1 && command -v cargo >/dev/null 2>&1; then
  RV="$(rustc --version | awk '{print $2}')"
  RMIN="1.77.2"
  if [ "$(printf '%s\n%s\n' "$RMIN" "$RV" | sort -V | head -1)" = "$RMIN" ]; then ok "Rust $RV"; else
    bad "Rust $RV 太旧（需要 ≥ $RMIN）"; fix "rustup update stable"; fi
else
  bad "未安装 Rust"
  fix "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
  fix "source \"\$HOME/.cargo/env\""
fi

# ---- Node
if command -v node >/dev/null 2>&1; then
  NV="$(node -v | sed 's/^v//')"
  NMAJ="${NV%%.*}"
  if [ "$NMAJ" -ge 20 ] 2>/dev/null; then ok "Node.js $NV"; else
    bad "Node.js $NV 太旧（需要 ≥ 20）"; fix "brew install node@22   # 或使用 nvm: nvm install 22"; fi
else
  bad "未安装 Node.js（需要 ≥ 20）"
  if command -v brew >/dev/null 2>&1; then fix "brew install node@22"; else
    fix "/bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\"   # 先装 Homebrew"
    fix "brew install node@22"; fi
fi

# ---- pnpm
if command -v pnpm >/dev/null 2>&1; then
  PV="$(pnpm -v)"; PMAJ="${PV%%.*}"
  if [ "$PMAJ" -ge 9 ] 2>/dev/null; then ok "pnpm $PV"; else bad "pnpm $PV 太旧（需要 ≥ 9）"; fix "npm install -g pnpm@latest"; fi
else
  bad "未安装 pnpm"
  fix "corepack enable && corepack prepare pnpm@latest --activate   # 或：npm install -g pnpm"
fi

# ---- Chrome (optional)
if [ "$OS" = "Darwin" ]; then
  if [ -d "/Applications/Google Chrome.app" ]; then ok "Google Chrome 已安装"; else
    warn "未找到 Google Chrome（浏览器扩展需要 Chrome 116+ 或其他 Chromium 浏览器）"; fi
fi

# ---- Live2D (optional)
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [ -f "$ROOT/apps/desktop/public/live2d/live2dcubismcore.min.js" ]; then ok "Live2D Cubism Core 已放置（可选）"; else
  warn "未放置 Live2D Cubism Core（可选；不放置时使用内置 SVG 猫娘）"; fix "bash scripts/setup-live2d.sh"; fi

echo
if [ "$MISSING" -eq 0 ]; then
  echo "环境就绪 ✅  下一步："
  echo "  pnpm install"
  echo "  pnpm --filter @desktop-pet/desktop tauri build"
  echo "  产物：apps/desktop/src-tauri/target/release/bundle/dmg/DesktopPet_0.1.0_<arch>.dmg"
else
  echo "缺少 $MISSING 项，请按上面的 → 命令安装后重新运行本脚本。"
  exit 1
fi
