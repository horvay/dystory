#!/usr/bin/env bash
# Builds whisper.cpp's server and downloads a Whisper model into .stt/ for
# dictation. Run it once (`bun run stt:setup`); `bun run dev` then serves it.
#
#   STT_MODEL=base.en bun run stt:setup   # a different model (see README)
#   STT_GPU=0 bun run stt:setup           # CPU only, skip the Vulkan build
#
# The GPU build uses Vulkan, which works on older NVIDIA cards (like the
# GTX 950 here) that current CUDA toolkits no longer support. Without sudo
# it fetches the Vulkan headers itself; it only needs the driver's Vulkan
# loader (libvulkan) and glslc (the shaderc package) to be installed.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIR="$ROOT/.stt"
WHISPER_VERSION="${WHISPER_VERSION:-v1.9.5}"
VULKAN_HEADERS_VERSION="${VULKAN_HEADERS_VERSION:-v1.4.357}"
MODEL="${STT_MODEL:-small.en}"
VAD_MODEL="silero-v6.2.0"
GPU="${STT_GPU:-1}"

mkdir -p "$DIR/models"
cd "$DIR"

say() { printf '\033[1m[stt]\033[0m %s\n' "$*"; }

if cmake --version >/dev/null 2>&1; then
  CMAKE=(cmake)
elif command -v mise >/dev/null; then
  say "cmake isn't installed; using mise's"
  CMAKE=(mise x cmake@4 -- cmake)
else
  echo "Install cmake first (pacman -S cmake)." >&2
  exit 1
fi

if [ ! -d whisper.cpp ] || [ "$(git -C whisper.cpp describe --tags 2>/dev/null)" != "$WHISPER_VERSION" ]; then
  say "Fetching whisper.cpp $WHISPER_VERSION"
  rm -rf whisper.cpp
  git clone --quiet --depth 1 --branch "$WHISPER_VERSION" https://github.com/ggml-org/whisper.cpp.git
fi

FLAGS=(-DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DWHISPER_BUILD_TESTS=OFF -DWHISPER_SDL2=OFF)
if [ "$GPU" != "0" ] && command -v glslc >/dev/null && ldconfig -p | grep 'libvulkan\.so' >/dev/null; then
  FLAGS+=(-DGGML_VULKAN=ON -DCMAKE_PREFIX_PATH="$DIR/prefix")
  # Header-only packages (vulkan-headers, spirv-headers on Arch), installed
  # here when the system doesn't have them.
  headers() {
    local repo=$1 tag=$2
    if [ -f "$DIR/prefix/.$repo-$tag" ]; then return; fi
    say "Fetching $repo $tag"
    rm -rf "src-$repo"
    git clone --quiet --depth 1 --branch "$tag" "https://github.com/KhronosGroup/$repo.git" "src-$repo"
    "${CMAKE[@]}" -S "src-$repo" -B "src-$repo/build" -DCMAKE_INSTALL_PREFIX="$DIR/prefix" >/dev/null
    "${CMAKE[@]}" --install "src-$repo/build" >/dev/null
    rm -rf "src-$repo"
    touch "$DIR/prefix/.$repo-$tag"
  }
  if [ ! -f /usr/include/vulkan/vulkan.h ]; then
    headers Vulkan-Headers "$VULKAN_HEADERS_VERSION"
    FLAGS+=(-DVulkan_INCLUDE_DIR="$DIR/prefix/include")
  fi
  if [ ! -d /usr/include/spirv ]; then
    headers SPIRV-Headers "vulkan-sdk-${VULKAN_HEADERS_VERSION#v}.0"
  fi
  say "Building whisper-server with Vulkan (GPU)"
else
  FLAGS+=(-DGGML_VULKAN=OFF)
  say "Building whisper-server for the CPU"
fi

"${CMAKE[@]}" -S whisper.cpp -B build "${FLAGS[@]}" >/dev/null
"${CMAKE[@]}" --build build --target whisper-server -j "$(nproc)"
# Renamed into place, since the running server keeps the old file busy.
cp build/bin/whisper-server "$DIR/whisper-server.new"
mv -f "$DIR/whisper-server.new" "$DIR/whisper-server"

fetch() {
  local name=$1 url=$2
  if [ -s "models/$name" ]; then return; fi
  say "Downloading $name"
  curl -fL --progress-bar -o "models/$name.part" "$url"
  mv "models/$name.part" "models/$name"
}
fetch "ggml-$MODEL.bin" "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-$MODEL.bin"
fetch "ggml-$VAD_MODEL.bin" "https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-$VAD_MODEL.bin"

say "Done. Dictation uses models/ggml-$MODEL.bin; restart \`bun run dev\` to pick it up."
