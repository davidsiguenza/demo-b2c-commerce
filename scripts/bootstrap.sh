#!/usr/bin/env bash
# bootstrap.sh — one-shot setup for the Demo B2C Commerce orchestrator.
#
# Removes the manual friction (npm link of the toolkit, pnpm install of the
# BFF) and prints the one step that can't be scripted: registering the
# marketplace in Claude Code.
#
# Idempotent and safe to re-run. Verifies prereqs first (warns, doesn't
# hard-fail on optional tools).
#
# Usage:
#   ./scripts/bootstrap.sh            # verify + link toolkit + install bff deps
#   ./scripts/bootstrap.sh --check    # verify prereqs only, no installs

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

CHECK_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --check) CHECK_ONLY=1 ;;
    -h|--help) echo "Usage: $0 [--check]"; exit 0 ;;
  esac
done

# ───── tiny color helpers (self-contained) ─────
if [[ -t 1 ]]; then
  BOLD=$'\033[1m'; RED=$'\033[31m'; GRN=$'\033[32m'; YEL=$'\033[33m'; CYN=$'\033[36m'; RST=$'\033[0m'
else
  BOLD=''; RED=''; GRN=''; YEL=''; CYN=''; RST=''
fi
step() { echo; echo "${BOLD}${CYN}▶ $*${RST}"; }
ok()   { echo "  ${GRN}✓${RST} $*"; }
warn() { echo "  ${YEL}!${RST} $*"; }
fail() { echo "  ${RED}✗${RST} $*"; }

WARNINGS=0

have() { command -v "$1" >/dev/null 2>&1; }

# ───── 1. prerequisites ─────
step "Prerequisites"
for tool in node pnpm git; do
  if have "$tool"; then ok "$tool present ($("$tool" --version 2>&1 | head -n1))"
  else fail "$tool not found — required"; WARNINGS=$((WARNINGS+1)); fi
done
# B2C / Salesforce CLIs are needed by the sub-skills, recommended here.
for tool in b2c sf; do
  if have "$tool"; then ok "$tool present"
  else warn "$tool not found — needed by sub-skills (catalog / org steps)"; WARNINGS=$((WARNINGS+1)); fi
done

if [[ $CHECK_ONLY -eq 1 ]]; then
  step "Check-only mode — skipping installs"
  [[ $WARNINGS -gt 0 ]] && warn "$WARNINGS warning(s)" || ok "all prerequisites present"
  exit 0
fi

# ───── 2. sfn-demo-toolkit (npm link) ─────
TOOLKIT_DIR="$REPO_ROOT/packages/sfn-demo-toolkit"
step "sfn-demo-toolkit CLI"
if [[ -d "$TOOLKIT_DIR" ]]; then
  # Clear any stale global link from the old standalone repo to avoid collision.
  npm unlink -g @davidsiguenza/sfn-demo-toolkit >/dev/null 2>&1 || true
  ( cd "$TOOLKIT_DIR" && npm install >/dev/null 2>&1 && npm link >/dev/null 2>&1 )
  if have sfn-toolkit; then ok "sfn-toolkit linked ($(sfn-toolkit --version 2>&1 | head -n1))"
  else warn "npm link ran but 'sfn-toolkit' not on PATH — check your npm global bin dir"; WARNINGS=$((WARNINGS+1)); fi
else
  warn "packages/sfn-demo-toolkit not present yet (Phase 1) — skipping link"
  WARNINGS=$((WARNINGS+1))
fi

# ───── 3. b2c-catalog-onboarding-bff (deps) ─────
BFF_DIR="$REPO_ROOT/packages/b2c-catalog-onboarding-bff"
step "b2c-catalog-onboarding-bff"
if [[ -d "$BFF_DIR" ]]; then
  ( cd "$BFF_DIR" && pnpm install >/dev/null 2>&1 )
  ok "BFF dependencies installed"
else
  warn "packages/b2c-catalog-onboarding-bff not present yet (Phase 2) — skipping"
  WARNINGS=$((WARNINGS+1))
fi

# ───── 4. manual step: register the marketplace ─────
step "Register the marketplace in Claude Code (manual — can't be scripted)"
cat <<'EOF'
  In any Claude Code conversation, run /plugin add-marketplace and paste the
  HTTPS URL when prompted (NOT the "github owner/repo" shortcut — that uses SSH
  and fails without an authorized key):

    https://github.com/davidsiguenza/demo-b2c-commerce.git

  Then install the three plugins:

    /plugin install demo-b2c-commerce@demo-b2c-commerce
    /plugin install dsp-storefrontnext-demo@demo-b2c-commerce
    /plugin install b2c-catalog-onboarding@demo-b2c-commerce

  Then, from your demo working dir, start the flow with:

    "Quiero hacer una demo de B2C Commerce"
EOF

step "Summary"
[[ $WARNINGS -gt 0 ]] && warn "$WARNINGS warning(s) — see above" || ok "bootstrap complete"
exit 0
