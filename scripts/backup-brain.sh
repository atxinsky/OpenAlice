#!/usr/bin/env bash
# =============================================================================
# Alice Brain Backup — GitHub Push Script
# 用途: 将 Alice 完整记忆数据库备份到独立的私有 GitHub 仓库
# 使用: ./scripts/backup-brain.sh
#       ./scripts/backup-brain.sh --init   (首次初始化仓库)
# =============================================================================

set -euo pipefail

# -----------------------------------------------------------------------------
# 配置区
# -----------------------------------------------------------------------------
GITHUB_REPO="https://github.com/atxinsky/alice-brain.git"
BACKUP_DIR="/Users/tretra/OpenAlice/.brain-backup"
SOURCE_ROOT="/Users/tretra/OpenAlice"

# -----------------------------------------------------------------------------
# 颜色输出
# -----------------------------------------------------------------------------
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info()  { echo -e "${GREEN}[backup]${NC} $*"; }
warn()  { echo -e "${YELLOW}[warn]${NC}  $*"; }
error() { echo -e "${RED}[error]${NC} $*"; exit 1; }

# -----------------------------------------------------------------------------
# --init 模式：首次初始化本地备份仓库
# -----------------------------------------------------------------------------
if [[ "${1:-}" == "--init" ]]; then
  info "初始化备份仓库..."
  mkdir -p "$BACKUP_DIR"
  cd "$BACKUP_DIR"
  git init
  git remote add origin "$GITHUB_REPO"
  mkdir -p brain config cron sessions default/skills
  echo "# Alice Brain Backup" > README.md
  echo "自动备份仓库，请勿手动修改。由 backup-brain.sh 维护。" >> README.md
  git add README.md
  git commit -m "init: Alice brain backup repo"
  git push -u origin main
  info "初始化完成！以后直接运行 ./scripts/backup-brain.sh 即可。"
  exit 0
fi

# -----------------------------------------------------------------------------
# 检查备份仓库是否已初始化
# -----------------------------------------------------------------------------
if [[ ! -d "$BACKUP_DIR/.git" ]]; then
  error "备份仓库未初始化！请先运行: ./scripts/backup-brain.sh --init"
fi

cd "$BACKUP_DIR"

# ═════════════════════════════════════════════════════════════════════════════
# Tier 1 — 核心记忆（brain + cron）
# ═════════════════════════════════════════════════════════════════════════════
info "同步 Tier 1 核心记忆..."
mkdir -p brain cron

TIER1_FILES=(
  "data/brain/frontal-lobe.md"
  "data/brain/sc-database.md"
  "data/brain/trading-philosophy.md"
  "data/brain/persona.md"
  "data/brain/commit.json"
  "data/brain/paper-trading.json"
  "data/brain/trade-log.md"
  "data/brain/backtest-framework.md"
  "data/cron/jobs.json"
)

for rel_path in "${TIER1_FILES[@]}"; do
  src="$SOURCE_ROOT/$rel_path"
  filename=$(basename "$rel_path")
  if [[ "$rel_path" == data/brain/* ]]; then
    dest="$BACKUP_DIR/brain/$filename"
  elif [[ "$rel_path" == data/cron/* ]]; then
    dest="$BACKUP_DIR/cron/$filename"
  fi
  if [[ -f "$src" ]]; then
    cp "$src" "$dest"
    info "  copied: $rel_path"
  else
    warn "  skipped (not found): $rel_path"
  fi
done

# ═════════════════════════════════════════════════════════════════════════════
# Tier 1b — SC 数据沉淀目录（sc-snapshots + sc-reports）
# ═════════════════════════════════════════════════════════════════════════════
info "同步 Tier 1b SC 数据沉淀目录..."
mkdir -p brain/sc-snapshots brain/sc-reports

# sc-snapshots：每日收盘流水 + 每周快照（Layer 2）
if [[ -d "$SOURCE_ROOT/data/brain/sc-snapshots" ]]; then
  cp -r "$SOURCE_ROOT/data/brain/sc-snapshots/." "$BACKUP_DIR/brain/sc-snapshots/"
  info "  copied: data/brain/sc-snapshots/ (Layer 2 全量)"
else
  warn "  skipped (not yet created): data/brain/sc-snapshots/"
fi

# sc-reports：周报 + 月报文件（Layer 3）
if [[ -d "$SOURCE_ROOT/data/brain/sc-reports" ]]; then
  cp -r "$SOURCE_ROOT/data/brain/sc-reports/." "$BACKUP_DIR/brain/sc-reports/"
  info "  copied: data/brain/sc-reports/ (Layer 3 全量)"
else
  warn "  skipped (not yet created): data/brain/sc-reports/"
fi

# daily-plan：盘前计划（保留最近 30 个文件，避免无限堆积）
mkdir -p brain/daily-plans
find "$SOURCE_ROOT/data/brain" -maxdepth 1 -name "daily-plan-*.md" \
  | sort | tail -30 | while read -r f; do
    cp "$f" "$BACKUP_DIR/brain/daily-plans/"
  done
info "  copied: daily-plan-*.md (最近30份)"

# ═════════════════════════════════════════════════════════════════════════════
# Tier 2 — 配置文件（敏感字段脱敏）
# ═════════════════════════════════════════════════════════════════════════════
info "同步 Tier 2 配置文件..."
mkdir -p config

CONFIG_FILES=(
  "data/config/agent.json"
  "data/config/accounts.json"
  "data/config/platforms.json"
  "data/config/crypto.json"
  "data/config/securities.json"
  "data/config/news.json"
  "data/config/engine.json"
  "data/config/heartbeat.json"
  "data/config/tools.json"
  "data/config/connectors.json"
  "data/config/ai-provider-manager.json"
  "data/config/compaction.json"
  "data/config/market-data.json"
)

for rel_path in "${CONFIG_FILES[@]}"; do
  src="$SOURCE_ROOT/$rel_path"
  filename=$(basename "$rel_path")
  dest="$BACKUP_DIR/config/$filename"
  if [[ -f "$src" ]]; then
    sed -E \
      -e 's/("apiKey"\s*:\s*")[^"]+(")/\1***REDACTED***\2/g' \
      -e 's/("apiSecret"\s*:\s*")[^"]+(")/\1***REDACTED***\2/g' \
      -e 's/("secret"\s*:\s*")[^"]+(")/\1***REDACTED***\2/g' \
      -e 's/("token"\s*:\s*")[^"]+(")/\1***REDACTED***\2/g' \
      -e 's/("password"\s*:\s*")[^"]+(")/\1***REDACTED***\2/g' \
      "$src" > "$dest"
    info "  copied (redacted): $rel_path"
  else
    warn "  skipped (not found): $rel_path"
  fi
done

# ═════════════════════════════════════════════════════════════════════════════
# Tier 3 — 会话历史（sessions）
# ═════════════════════════════════════════════════════════════════════════════
info "同步 Tier 3 会话历史..."
mkdir -p sessions/web sessions/cron sessions/telegram

# Web session
[ -f "$SOURCE_ROOT/data/sessions/web/default.jsonl" ] && \
  cp "$SOURCE_ROOT/data/sessions/web/default.jsonl" "$BACKUP_DIR/sessions/web/default.jsonl" && \
  info "  copied: sessions/web/default.jsonl"

# Cron session
[ -f "$SOURCE_ROOT/data/sessions/cron/default.jsonl" ] && \
  cp "$SOURCE_ROOT/data/sessions/cron/default.jsonl" "$BACKUP_DIR/sessions/cron/default.jsonl" && \
  info "  copied: sessions/cron/default.jsonl"

# Heartbeat session
[ -f "$SOURCE_ROOT/data/sessions/heartbeat.jsonl" ] && \
  cp "$SOURCE_ROOT/data/sessions/heartbeat.jsonl" "$BACKUP_DIR/sessions/heartbeat.jsonl" && \
  info "  copied: sessions/heartbeat.jsonl"

# Telegram sessions (all .jsonl files)
for tg_file in "$SOURCE_ROOT"/data/sessions/telegram/*.jsonl; do
  if [[ -f "$tg_file" ]]; then
    cp "$tg_file" "$BACKUP_DIR/sessions/telegram/"
    info "  copied: sessions/telegram/$(basename "$tg_file")"
  fi
done

# ═════════════════════════════════════════════════════════════════════════════
# Tier 4 — 运行时数据（news, events, tool-calls, cache）
# ═════════════════════════════════════════════════════════════════════════════
info "同步 Tier 4 运行时数据..."
mkdir -p runtime cache/equity

# News collector
[ -f "$SOURCE_ROOT/data/news-collector/news.jsonl" ] && \
  cp "$SOURCE_ROOT/data/news-collector/news.jsonl" "$BACKUP_DIR/runtime/news.jsonl" && \
  info "  copied: news-collector/news.jsonl"

# Event log
[ -f "$SOURCE_ROOT/data/event-log/events.jsonl" ] && \
  cp "$SOURCE_ROOT/data/event-log/events.jsonl" "$BACKUP_DIR/runtime/events.jsonl" && \
  info "  copied: event-log/events.jsonl"

# Tool calls
[ -f "$SOURCE_ROOT/data/tool-calls/tool-calls.jsonl" ] && \
  cp "$SOURCE_ROOT/data/tool-calls/tool-calls.jsonl" "$BACKUP_DIR/runtime/tool-calls.jsonl" && \
  info "  copied: tool-calls/tool-calls.jsonl"

# Cache
[ -f "$SOURCE_ROOT/data/cache/equity/symbols.json" ] && \
  cp "$SOURCE_ROOT/data/cache/equity/symbols.json" "$BACKUP_DIR/cache/equity/symbols.json" && \
  info "  copied: cache/equity/symbols.json"

# ═════════════════════════════════════════════════════════════════════════════
# Tier 5 — 默认模板
# ═════════════════════════════════════════════════════════════════════════════
info "同步 Tier 5 默认模板..."
mkdir -p default/skills

[ -f "$SOURCE_ROOT/data/default/persona.default.md" ] && \
  cp "$SOURCE_ROOT/data/default/persona.default.md" "$BACKUP_DIR/default/" && \
  info "  copied: default/persona.default.md"

[ -f "$SOURCE_ROOT/data/default/heartbeat.default.md" ] && \
  cp "$SOURCE_ROOT/data/default/heartbeat.default.md" "$BACKUP_DIR/default/" && \
  info "  copied: default/heartbeat.default.md"

for skill_file in "$SOURCE_ROOT"/data/default/skills/*.md; do
  if [[ -f "$skill_file" ]]; then
    cp "$skill_file" "$BACKUP_DIR/default/skills/"
    info "  copied: default/skills/$(basename "$skill_file")"
  fi
done

# ═════════════════════════════════════════════════════════════════════════════
# 备份元数据
# ═════════════════════════════════════════════════════════════════════════════
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
cat > "$BACKUP_DIR/backup-meta.json" <<EOF
{
  "lastBackup": "$TIMESTAMP",
  "sourceHost": "$(hostname)",
  "sourcePath": "$SOURCE_ROOT",
  "tiers": {
    "tier1_brain": ${#TIER1_FILES[@]},
    "tier1b_sc_data": "sc-snapshots + sc-reports + daily-plans",
    "tier2_config": ${#CONFIG_FILES[@]},
    "tier3_sessions": "web + cron + heartbeat + telegram",
    "tier4_runtime": "news + events + tool-calls + cache",
    "tier5_defaults": "persona + heartbeat + skills"
  }
}
EOF

# ═════════════════════════════════════════════════════════════════════════════
# git add / commit / push
# ═════════════════════════════════════════════════════════════════════════════
info "提交到 GitHub..."

git add -A

if git diff --cached --quiet; then
  info "没有文件变更，跳过 commit。"
  exit 0
fi

COMMIT_MSG="backup: full snapshot @ $TIMESTAMP"
git commit -m "$COMMIT_MSG"
git push origin main

info ""
info "=========================================="
info "  备份完成！ $TIMESTAMP"
info "  推送到: $GITHUB_REPO"
info "=========================================="
