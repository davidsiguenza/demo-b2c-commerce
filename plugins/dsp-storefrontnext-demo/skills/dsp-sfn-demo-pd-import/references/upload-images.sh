#!/usr/bin/env bash
# Upload static images to a B2C library so they appear in the BM CMS and are
# served at /on/demandware.static/-/Library-Sites-<libraryId>/default/...
#
# IMPORTANT: This is NOT the same as `b2c webdav put`. The b2c CLI uploads to
# /Impex/libraries/ which is a staging area for site-archive imports. The CMS
# mount for static files is /on/demandware.servlet/webdav/Sites/Libraries/...
# and requires a Business Manager user (not the API client_id/secret).
#
# Usage: ./upload-images.sh <library-id> <local-dir> <remote-subfolder>
# Example:
#   ./upload-images.sh mayoral-SharedLibrary \
#                      /path/to/cartridge/public/images/brands/mayoral \
#                      brands/mayoral

set -euo pipefail

LIBRARY_ID="${1:?library-id required (e.g. mayoral-SharedLibrary)}"
LOCAL_DIR="${2:?local directory required}"
REMOTE_SUBFOLDER="${3:-}"

# Read credentials from project's dw.json (run from project root)
HOST=$(jq -r '.hostname' dw.json)
USER=$(jq -r '.username' dw.json)
PASS=$(jq -r '.password' dw.json)

LIBPATH="/on/demandware.servlet/webdav/Sites/Libraries/${LIBRARY_ID}/default/images"
PUBLIC_BASE="https://${HOST}/on/demandware.static/-/Library-Sites-${LIBRARY_ID}/default/images"

# Create folder if needed (MKCOL is idempotent — 405 if exists)
if [[ -n "${REMOTE_SUBFOLDER}" ]]; then
  IFS='/' read -ra PARTS <<< "${REMOTE_SUBFOLDER}"
  CURRENT=""
  for part in "${PARTS[@]}"; do
    CURRENT="${CURRENT}/${part}"
    curl -s -u "${USER}:${PASS}" -X MKCOL "https://${HOST}${LIBPATH}${CURRENT}" -o /dev/null
  done
  TARGET_PATH="${LIBPATH}/${REMOTE_SUBFOLDER}"
  PUBLIC_PATH="${PUBLIC_BASE}/${REMOTE_SUBFOLDER}"
else
  TARGET_PATH="${LIBPATH}"
  PUBLIC_PATH="${PUBLIC_BASE}"
fi

# Upload each file
for FILE in "${LOCAL_DIR}"/*; do
  [[ -f "${FILE}" ]] || continue
  NAME=$(basename "${FILE}")
  STATUS=$(curl -s -u "${USER}:${PASS}" -T "${FILE}" \
           "https://${HOST}${TARGET_PATH}/${NAME}" \
           -w "%{http_code}" -o /dev/null)
  echo "PUT ${NAME}: ${STATUS}"

  # Verify public access
  CHECK=$(curl -sI "${PUBLIC_PATH}/${NAME}" | head -1)
  echo "  → ${PUBLIC_PATH}/${NAME} ${CHECK}"
done
