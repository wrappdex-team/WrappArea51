#!/bin/bash
# =====================================================
# WRAPpDEX - Professional Predict.tsx Backup Script
# Usage: bash scripts/backup-predict.sh "Description of change"
# =====================================================

set -e

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SNAPSHOT_DIR="$PROJECT_ROOT/recovery-snapshots"
TIMESTAMP=$(date +"%Y-%m-%d_%H%M%S")
DESCRIPTION=${1:-"Manual checkpoint"}

mkdir -p "$SNAPSHOT_DIR"

SNAPSHOT_NAME="${TIMESTAMP}__${DESCRIPTION// /_}"
SNAPSHOT_PATH="$SNAPSHOT_DIR/$SNAPSHOT_NAME"

mkdir -p "$SNAPSHOT_PATH"

echo "Creating snapshot: $SNAPSHOT_NAME"

# Copy current Predict.tsx
if [ -f "$PROJECT_ROOT/src/app/components/Predict.tsx" ]; then
    cp "$PROJECT_ROOT/src/app/components/Predict.tsx" "$SNAPSHOT_PATH/Predict.tsx"
    echo "  - Predict.tsx copied"
fi

# Copy extracted components
cp "$PROJECT_ROOT/src/app/components/TreasuryAdminPanel.tsx" "$SNAPSHOT_PATH/" 2>/dev/null || true
cp "$PROJECT_ROOT/src/app/components/PredictionHistory.tsx" "$SNAPSHOT_PATH/" 2>/dev/null || true

# Create state file
cat > "$SNAPSHOT_PATH/STATE.txt" << EOF
Snapshot: $SNAPSHOT_NAME
Date: $(date)
Description: $DESCRIPTION
Branch: $(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
Commit: $(git rev-parse --short HEAD 2>/dev/null || echo "uncommitted")

Files included:
- Predict.tsx
- TreasuryAdminPanel.tsx (if existed)
- PredictionHistory.tsx (if existed)

Notes:
This snapshot was created as part of the professional recovery process.
EOF

echo "Snapshot saved to: $SNAPSHOT_PATH"

# Keep only the last 12 snapshots
cd "$SNAPSHOT_DIR"
ls -1dt */ 2>/dev/null | tail -n +13 | xargs rm -rf -- 2>/dev/null || true

echo "Cleanup complete. Last 12 snapshots retained."
echo "Step complete."