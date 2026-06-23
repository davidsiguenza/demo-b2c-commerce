#!/usr/bin/env bash
# Build a site archive zip (with the correct layout for shared OR site-private
# libraries) and import it via the b2c CLI.
#
# Usage:
#   ./build-and-import.sh shared       <library-id>  <library-xml-path>  [images-dir] [client-folder]
#   ./build-and-import.sh site-private <site-id>     <library-xml-path>  [images-dir] [client-folder]
#
# Examples:
#   ./build-and-import.sh shared mayoral-SharedLibrary /tmp/mayoral.xml \
#     public/images/brands/mayoral mayoral
#   ./build-and-import.sh site-private bimbaylola /tmp/bimbaylola.xml \
#     public/images/brands/bimbaylola bimbaylola
#
# When [images-dir] and [client-folder] are provided, the images are bundled
# into the archive at <library-static>/default/images/brands/<client-folder>/
# so a single import publishes XML + assets together.
#
# Run from the project root (where dw.json lives).

set -euo pipefail

MODE="${1:?mode required: shared | site-private}"
ID="${2:?library-id (shared) or site-id (site-private) required}"
LIBRARY_XML="${3:?library.xml path required}"
IMAGES_DIR="${4:-}"
CLIENT_FOLDER="${5:-}"

ARCHIVE_NAME="${ID}-import"
BUILD_DIR="/tmp/${ARCHIVE_NAME}-build"
ZIP_PATH="/tmp/${ARCHIVE_NAME}.zip"

rm -rf "${BUILD_DIR}" "${ZIP_PATH}"

case "${MODE}" in
  shared)
    LIB_ROOT="${BUILD_DIR}/${ARCHIVE_NAME}/libraries/${ID}"
    ;;
  site-private)
    LIB_ROOT="${BUILD_DIR}/${ARCHIVE_NAME}/sites/${ID}/library"
    ;;
  *)
    echo "Unknown mode: ${MODE} (expected 'shared' or 'site-private')" >&2
    exit 1
    ;;
esac

mkdir -p "${LIB_ROOT}"
cp "${LIBRARY_XML}" "${LIB_ROOT}/library.xml"

if [[ -n "${IMAGES_DIR}" && -n "${CLIENT_FOLDER}" ]]; then
  STATIC_DIR="${LIB_ROOT}/static/default/images/brands/${CLIENT_FOLDER}"
  mkdir -p "${STATIC_DIR}"
  cp -R "${IMAGES_DIR}/." "${STATIC_DIR}/"
  echo "--- Bundled images from ${IMAGES_DIR} into archive ---"
fi

cd "${BUILD_DIR}" && zip -rq "${ZIP_PATH}" "${ARCHIVE_NAME}/"
cd - > /dev/null

echo "--- Uploading zip to /Impex/src/instance ---"
b2c webdav put "${ZIP_PATH}" "/src/instance/${ARCHIVE_NAME}.zip"

echo "--- Importing site archive ---"
b2c job import "${ARCHIVE_NAME}.zip" --remote --wait --show-log

echo "--- Verifying with content list ---"
if [[ "${MODE}" == "site-private" ]]; then
  b2c content list --library "${ID}" --site-library --tree
else
  b2c content list --library "${ID}" --tree
fi
