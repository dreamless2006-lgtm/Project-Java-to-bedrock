#!/usr/bin/env bash
# Real AI bridge on an Android phone (Termux). One line installs and starts it:
#   curl -sL https://raw.githubusercontent.com/dreamless2006-lgtm/Project-Java-to-bedrock/ccr-72baab68-lqswgf/bridge/phone.sh | bash
# Run the same line again later to update and start again.
set -e
BRANCH="ccr-72baab68-lqswgf"
REPO="https://github.com/dreamless2006-lgtm/Project-Java-to-bedrock.git"
DIR="$HOME/real-ai"
if command -v pkg >/dev/null 2>&1; then
    pkg install -y nodejs-lts git >/dev/null 2>&1 || pkg install -y nodejs-lts git
    command -v termux-wake-lock >/dev/null 2>&1 && termux-wake-lock || true
fi
command -v node >/dev/null 2>&1 || { echo "Node.js is missing. In Termux run: pkg install nodejs-lts git"; exit 1; }
if [ -d "$DIR/.git" ]; then
    git -C "$DIR" pull --ff-only origin "$BRANCH" || true
else
    git clone --depth 1 -b "$BRANCH" "$REPO" "$DIR"
fi
cd "$DIR/bridge"
[ -d node_modules ] || npm install --no-audit --no-fund --omit=optional || npm install --no-audit --no-fund
echo
echo "Real AI bridge is installed in $DIR. Starting it (first run asks a few questions)..."
echo "Next time, just run:  bash ~/real-ai/bridge/phone.sh"
echo
exec node index.mjs < /dev/tty
