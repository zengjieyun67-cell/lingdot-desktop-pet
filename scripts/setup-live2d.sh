#!/usr/bin/env bash
# Live2D 设置向导。
#
# Live2D Cubism Core（live2dcubismcore.min.js）受 Live2D Proprietary Software License
# 约束，不能随本项目分发，因此本脚本不会自动下载它，只会：
#   1) 告诉你去哪里下载、放到哪里；
#   2) 检查你放置的文件；
#   3) 可选：把你下载好的 SDK zip / 模型目录复制到正确位置。
#
# 用法：
#   bash scripts/setup-live2d.sh                       # 查看说明并检查
#   bash scripts/setup-live2d.sh --sdk ~/Downloads/CubismSdkForWeb-5-r.x.zip
#   bash scripts/setup-live2d.sh --model ~/Downloads/MyCatgirl   # 包含 *.model3.json 的目录
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PUB="$ROOT/apps/desktop/public/live2d"
mkdir -p "$PUB/models"

SDK=""
MODEL=""
while [ $# -gt 0 ]; do
  case "$1" in
    --sdk) SDK="${2:-}"; shift 2 ;;
    --model) MODEL="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,14p' "$0"; exit 0 ;;
    *) echo "未知参数：$1"; exit 1 ;;
  esac
done

cat <<'EOF'
================ Live2D 设置 ================
桌宠默认使用内置的 SVG 猫娘，开箱即用。想换成 Live2D 模型需要两样东西：

① Cubism Core（必需，需自行下载）
   1. 打开 Live2D 官网：https://www.live2d.com/en/sdk/download/web/
   2. 阅读并同意许可协议，下载「Cubism SDK for Web」zip
   3. 运行：bash scripts/setup-live2d.sh --sdk <下载的zip路径>
      （或手动把 zip 内 Core/live2dcubismcore.min.js 复制到
        apps/desktop/public/live2d/live2dcubismcore.min.js）

② Cubism 4 模型（.model3.json + moc3 + 贴图 + motions）
   - 使用你有权使用的模型（自己制作、购买或作者允许的免费模型）。
   - 方式 A（打包进应用）：bash scripts/setup-live2d.sh --model <模型目录>
       设置里的模型路径填：/live2d/models/<目录名>/<文件名>.model3.json
   - 方式 B（不重新打包）：把模型放到
       ~/Library/Application Support/com.desktoppet.app/live2d/<目录名>/
     设置里填它的绝对路径，例如
       /Users/<你>/Library/Application Support/com.desktoppet.app/live2d/neko/neko.model3.json
     （允许的位置：应用数据目录/live2d、~/Live2D、~/Documents/Live2D、下载、桌面）

③ 动作映射（可选）：桌宠状态 → 模型动作组 / 表情，按顺序取第一个存在的：
   idle            → Idle / Main
   working         → Working / Work / TapBody / Tap
   completed       → Happy / Joy / TapHead / FlickUp / Tap
   needs_attention → Alert / Surprised / Shake / Flick / TapBody
   找不到对应动作时，桌宠会在模型上方叠加 ✨ / 💖 / ❗ 徽标作为兜底。
   修改映射：apps/desktop/src/pet/renderer/Live2DRenderer.ts → LIVE2D_MOOD_MAP

注意：方式 A 的 Core 只有在「重新构建应用」后才会进入 .app；
      方式 B 可在设置里填写 Core 的绝对路径，无需重新构建。
=============================================
EOF

if [ -n "$SDK" ]; then
  [ -f "$SDK" ] || { echo "找不到 $SDK"; exit 1; }
  TMP="$(mktemp -d)"
  unzip -q "$SDK" -d "$TMP"
  CORE="$(find "$TMP" -name live2dcubismcore.min.js -path '*Core*' | head -1)"
  [ -n "$CORE" ] || { echo "zip 中未找到 Core/live2dcubismcore.min.js"; rm -rf "$TMP"; exit 1; }
  cp "$CORE" "$PUB/live2dcubismcore.min.js"
  rm -rf "$TMP"
  echo "✔ 已复制 Cubism Core → $PUB/live2dcubismcore.min.js"
fi

if [ -n "$MODEL" ]; then
  [ -d "$MODEL" ] || { echo "找不到目录 $MODEL"; exit 1; }
  M3="$(find "$MODEL" -maxdepth 2 -name '*.model3.json' | head -1)"
  [ -n "$M3" ] || { echo "目录中没有 *.model3.json（需要 Cubism 3/4 模型）"; exit 1; }
  NAME="$(basename "$MODEL")"
  rm -rf "$PUB/models/$NAME"
  cp -R "$MODEL" "$PUB/models/$NAME"
  REL="${M3#"$MODEL"/}"
  echo "✔ 已复制模型 → $PUB/models/$NAME"
  echo "  设置 → 角色（Live2D）→ 模型路径 填：/live2d/models/$NAME/$REL"
fi

echo
echo "检查："
if [ -f "$PUB/live2dcubismcore.min.js" ]; then echo "  ✔ Cubism Core 已就位"; else echo "  ✘ 尚未放置 Cubism Core"; fi
COUNT="$(find "$PUB/models" -name '*.model3.json' 2>/dev/null | wc -l | tr -d ' ')"
echo "  模型（打包内）：$COUNT 个"
find "$PUB/models" -name '*.model3.json' 2>/dev/null | sed "s#^$ROOT/apps/desktop/public#    /#; s#//#/#"
