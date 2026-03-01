#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$SCRIPT_DIR/../.."
RECALL_PATH="$PROJECT_ROOT/dist/adapters/claude-code/recall.js"
CAPTURE_PATH="$PROJECT_ROOT/dist/adapters/claude-code/capture.js"
INIT_PATH="$PROJECT_ROOT/dist/adapters/claude-code/init.js"

# Build if not already built
if [ ! -f "$RECALL_PATH" ]; then
  echo "Building agentic-recall..."
  cd "$PROJECT_ROOT"
  npm run build
fi

# Generate hooks config with absolute paths
HOOKS_TMP=$(mktemp)
cat > "$HOOKS_TMP" << EOF
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node $RECALL_PATH",
            "timeout": 10
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node $CAPTURE_PATH",
            "timeout": 10
          }
        ]
      }
    ],
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node $INIT_PATH",
            "timeout": 15
          }
        ]
      }
    ]
  }
}
EOF

# Merge into user settings
SETTINGS_FILE="$HOME/.claude/settings.json"
mkdir -p "$HOME/.claude"

if [ -f "$SETTINGS_FILE" ]; then
  if command -v jq &> /dev/null; then
    MERGED_TMP=$(mktemp)
    jq -s '.[0] * .[1]' "$SETTINGS_FILE" "$HOOKS_TMP" > "$MERGED_TMP"
    mv "$MERGED_TMP" "$SETTINGS_FILE"
  else
    echo "Error: jq is required to merge settings. Install with: sudo apt install jq"
    echo "Alternatively, manually copy the hooks from: $HOOKS_TMP"
    exit 1
  fi
else
  cp "$HOOKS_TMP" "$SETTINGS_FILE"
fi

rm -f "$HOOKS_TMP"

echo "agentic-recall hooks installed to $SETTINGS_FILE"
echo "  Recall:  UserPromptSubmit -> $RECALL_PATH"
echo "  Capture: Stop             -> $CAPTURE_PATH"
echo "  Init:    SessionStart     -> $INIT_PATH"
echo ""
echo "Restart Claude Code to activate."
