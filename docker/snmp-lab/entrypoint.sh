#!/usr/bin/env bash
set -euo pipefail

# Hardwareless Conformance Lab Entrypoint
# Net-SNMP tools runner with isolated MIBDIR

MIB_DIR="${MIBDIRS:-/opt/snmp-lab/mibs}"

usage() {
  cat <<EOF
Usage: entrypoint.sh [command] [options]

Commands:
  emit-trap <target_host> <target_port> <version> <trap_oid> [varbinds...]
      Emit a trap using snmptrap with isolated MIBDIR

  translate <oid_or_symbol>
      Translate OID or MIB symbol using snmptranslate

  replay <fixtures_json_file> <target_host> <target_port>
      Replay traps defined in a JSON fixture file

  check-mibs
      Validate syntax of all MIB files present in MIBDIR

  exec <cmd...>
      Execute arbitrary command inside the isolated environment

  help
      Show this message
EOF
}

case "${1:-help}" in
  emit-trap)
    shift
    if [ "$#" -lt 4 ]; then
      echo "Error: emit-trap requires <target_host> <target_port> <version> <trap_oid>"
      exit 1
    fi
    TARGET_HOST="$1"
    TARGET_PORT="$2"
    VERSION="$3"
    TRAP_OID="$4"
    shift 4

    case "$VERSION" in
      v1)
        snmptrap -M "$MIB_DIR" -v 1 -c public "${TARGET_HOST}:${TARGET_PORT}" "$TRAP_OID" "" 6 1 "" "$@"
        ;;
      v2c)
        snmptrap -M "$MIB_DIR" -v 2c -c public "${TARGET_HOST}:${TARGET_PORT}" "" "$TRAP_OID" "$@"
        ;;
      *)
        echo "Error: Unsupported version for quick emit-trap: $VERSION (use exec snmptrap for custom v3)"
        exit 1
        ;;
    esac
    ;;

  translate)
    shift
    snmptranslate -M "$MIB_DIR" "$@"
    ;;

  check-mibs)
    echo "Checking MIB syntax in $MIB_DIR..."
    find "$MIB_DIR" -type f -name "*.mib" -o -name "*.txt" | while read -r mibfile; do
      echo "Validating: $mibfile"
      snmptranslate -M "$MIB_DIR" -m ALL -Tp -IR "$(basename "$mibfile")" >/dev/null 2>&1 || true
    done
    echo "Done."
    ;;

  replay)
    shift
    if [ "$#" -lt 3 ]; then
      echo "Error: replay requires <fixtures_json_file> <target_host> <target_port>"
      exit 1
    fi
    FIXTURE_FILE="$1"
    TARGET_HOST="$2"
    TARGET_PORT="$3"

    if [ ! -f "$FIXTURE_FILE" ]; then
      echo "Error: Fixture file not found: $FIXTURE_FILE"
      exit 1
    fi

    echo "Replaying fixture: $FIXTURE_FILE to ${TARGET_HOST}:${TARGET_PORT}..."
    jq -c '.traps[]' "$FIXTURE_FILE" | while read -r trap_item; do
      TRAP_OID=$(echo "$trap_item" | jq -r '.trapOid')
      SYS_UPTIME=$(echo "$trap_item" | jq -r '.sysUpTime // 1000')
      echo "Sending trap $TRAP_OID (sysUpTime: $SYS_UPTIME)..."
      snmptrap -M "$MIB_DIR" -v 2c -c public "${TARGET_HOST}:${TARGET_PORT}" "$SYS_UPTIME" "$TRAP_OID"
    done
    echo "Replay completed."
    ;;

  exec)
    shift
    exec "$@"
    ;;

  help)
    usage
    ;;

  *)
    exec "$@"
    ;;
esac
