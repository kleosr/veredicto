#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
semgrep scan --error \
  --config p/security-audit \
  --config p/owasp-top-ten \
  --config p/secrets \
  --config p/trailofbits \
  --config p/typescript \
  --config p/javascript \
  --exclude dist --exclude node_modules \
  .
