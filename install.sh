#!/usr/bin/env bash
# ==============================================================================
# FTTH-Copilot — Production Server Installer & Bootstrapper
# Supported platforms: Linux (Ubuntu, Debian, RHEL, CentOS), macOS (with Docker Desktop/Colima)
# ==============================================================================

set -euo pipefail

# Colors and formatting
if [ -t 1 ]; then
  BOLD=$'\033[1m'
  DIM=$'\033[2m'
  RESET=$'\033[0m'
  CYAN=$'\033[36m'
  GREEN=$'\033[32m'
  YELLOW=$'\033[33m'
  RED=$'\033[31m'
else
  BOLD=""
  DIM=""
  RESET=""
  CYAN=""
  GREEN=""
  YELLOW=""
  RED=""
fi

# Print banner
print_banner() {
  clear 2>/dev/null || true
  cat << EOF
${CYAN}╔═══════════════════════════════════════════════════════════════════╗
║${BOLD}              FTTH-Copilot — Production Installer                  ${RESET}${CYAN}║
║${DIM}        AI-Powered Diagnostic Agent for FTTH / GPON ISPs           ${RESET}${CYAN}║
╚═══════════════════════════════════════════════════════════════════╝${RESET}

EOF
}

# Log helpers
info() { echo -e "  ${CYAN}ℹ${RESET} $1"; }
success() { echo -e "  ${GREEN}✓${RESET} $1"; }
warn() { echo -e "  ${YELLOW}⚠${RESET} $1"; }
error() { echo -e "  ${RED}✖${RESET} $1" >&2; }
header() { echo -e "\n${BOLD}$1${RESET}"; }

# Global state
NON_INTERACTIVE=false
APP_PORT_ARG=""
AI_PROVIDER_ARG=""
COMPOSE_BASE="docker compose"
COMPOSE_CMD="docker compose --env-file .env.prod -f docker-compose.prod.yml"

# Parse CLI arguments
parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      -y|--yes|--non-interactive|--ci)
        NON_INTERACTIVE=true
        shift
        ;;
      --port)
        APP_PORT_ARG="${2:-}"
        shift 2 || shift
        ;;
      --provider)
        AI_PROVIDER_ARG="${2:-}"
        shift 2 || shift
        ;;
      -h|--help)
        cat << EOF
Usage: ./install.sh [OPTIONS]

Options:
  -y, --yes, --non-interactive, --ci   Run installer in non-interactive/headless mode
  --port <PORT>                        Specify public web port (default: 3001)
  --provider <minimax|deepseek|qwen>   Specify AI provider (default: demo/offline)
  -h, --help                           Show this help message
EOF
        exit 0
        ;;
      *)
        warn "Unknown option: $1"
        shift
        ;;
    esac
  done

  if [ ! -t 0 ] || [ "${CI:-}" = "true" ] || [ "${CONTINUOUS_INTEGRATION:-}" = "true" ]; then
    NON_INTERACTIVE=true
  fi
}

# Safe environment file value reader (avoids arbitrary shell execution from 'source' or 'eval')
get_env_val() {
  local key="$1"
  local file="${2:-.env.prod}"
  if [ -f "$file" ]; then
    grep -E "^${key}=" "$file" 2>/dev/null | head -n 1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//" || true
  fi
}

# Pure bash RFC 3986 percent-encoder for URL credentials (preserves user:password@host parsing in PostgreSQL connection URLs)
url_encode() {
  local string="$1"
  local strlen=${#string}
  local encoded=""
  local pos c o
  for (( pos=0 ; pos<strlen ; pos++ )); do
    c="${string:$pos:1}"
    case "$c" in
      [-_.~a-zA-Z0-9] ) o="${c}" ;;
      * ) printf -v o '%%%02X' "'$c" ;;
    esac
    encoded+="${o}"
  done
  echo "${encoded}"
}

# Generate 32-byte random hex string
generate_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  else
    head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'
  fi
}

# Masked secret prompt (safe assignment without eval)
read_secret() {
  local prompt="$1"
  local var_name="$2"
  local default_val="${3:-}"

  if [ "$NON_INTERACTIVE" = true ]; then
    printf -v "$var_name" '%s' "$default_val"
    return 0
  fi

  if [ -t 0 ]; then
    printf "  ${BOLD}%s${RESET}" "$prompt"
    if [ -n "$default_val" ]; then
      printf " ${DIM}(leave empty to keep existing)${RESET}"
    fi
    printf ": "
    
    local secret=""
    stty -echo 2>/dev/null || true
    read -r secret
    stty echo 2>/dev/null || true
    printf "\n"

    if [ -z "$secret" ] && [ -n "$default_val" ]; then
      printf -v "$var_name" '%s' "$default_val"
    else
      printf -v "$var_name" '%s' "$secret"
    fi
  else
    local line=""
    read -r line
    if [ -z "$line" ] && [ -n "$default_val" ]; then
      printf -v "$var_name" '%s' "$default_val"
    else
      printf -v "$var_name" '%s' "$line"
    fi
  fi
}

# Standard input prompt with default value (safe assignment without eval)
read_input() {
  local prompt="$1"
  local var_name="$2"
  local default_val="${3:-}"

  if [ "$NON_INTERACTIVE" = true ]; then
    printf -v "$var_name" '%s' "$default_val"
    return 0
  fi

  printf "  ${BOLD}%s${RESET}" "$prompt"
  if [ -n "$default_val" ]; then
    printf " ${DIM}(%s)${RESET}" "$default_val"
  fi
  printf ": "

  local input=""
  read -r input
  if [ -z "$input" ] && [ -n "$default_val" ]; then
    printf -v "$var_name" '%s' "$default_val"
  else
    printf -v "$var_name" '%s' "$input"
  fi
}

# Check Docker installation, daemon status, and compose availability
check_docker() {
  header "Step 1: Verifying Infrastructure Prerequisites"

  local os_type
  os_type="$(uname -s)"

  if ! command -v docker >/dev/null 2>&1; then
    if [ "$os_type" = "Darwin" ]; then
      error "Docker was not found on macOS."
      info "Please install and start Docker Desktop (https://www.docker.com/products/docker-desktop) or OrbStack / Colima."
      info "Once running, re-execute ./install.sh."
      exit 1
    elif [ "$os_type" = "Linux" ]; then
      warn "Docker is not found on this system."
      if [ "$NON_INTERACTIVE" = true ]; then
        error "Docker is required to run the production stack. In non-interactive mode, automatic installation via curl is disabled."
        info "Please install Docker first (https://docs.docker.com/engine/install/) and rerun ./install.sh."
        exit 1
      fi

      local install_choice="y"
      read_input "Would you like to install Docker automatically using the official Linux script? [Y/n]" install_choice "y"
      if [[ "$install_choice" =~ ^[Yy]$ ]]; then
        info "Downloading and executing official Docker installation script..."
        curl -fsSL https://get.docker.com | sh
        if command -v sudo >/dev/null 2>&1 && [ "$EUID" -ne 0 ]; then
          sudo usermod -aG docker "$USER" 2>/dev/null || true
        fi
        if command -v systemctl >/dev/null 2>&1; then
          sudo systemctl enable --now docker 2>/dev/null || true
        fi
        success "Docker installed successfully."
      else
        error "Docker is required to run the production stack. Aborting."
        exit 1
      fi
    else
      error "Unsupported operating system: $os_type. Please install Docker manually."
      exit 1
    fi
  fi

  # Verify daemon is reachable
  if ! docker info >/dev/null 2>&1; then
    error "Docker is installed, but the Docker daemon is not running or current user lacks permissions."
    if [ "$os_type" = "Darwin" ]; then
      info "Make sure Docker Desktop, OrbStack, or Colima is active."
    else
      info "Troubleshooting:"
      info "  1. If Docker daemon is stopped: run 'sudo systemctl start docker'"
      info "  2. If user lacks permission: run 'sudo usermod -aG docker \$USER' and restart session"
      info "  3. If using rootless Docker: ensure the rootless daemon socket is active"
    fi
    exit 1
  fi

  local docker_version
  docker_version=$(docker --version 2>/dev/null | awk '{print $3}' | tr -d ',' || echo "detected")
  success "Docker daemon is active and accessible (v${docker_version})"

  # Check Docker Compose (v2 plugin or standalone)
  if docker compose version >/dev/null 2>&1; then
    local compose_version
    compose_version=$(docker compose version --short 2>/dev/null || echo "v2")
    success "Docker Compose plugin is available (${compose_version})"
    COMPOSE_BASE="docker compose"
  elif command -v docker-compose >/dev/null 2>&1; then
    success "docker-compose standalone is available"
    COMPOSE_BASE="docker-compose"
  else
    error "Docker Compose was not found. Please install docker-compose-plugin (e.g. 'sudo apt install docker-compose-plugin')."
    exit 1
  fi

  COMPOSE_CMD="${COMPOSE_BASE} --env-file .env.prod -f docker-compose.prod.yml"
}

# Configure environment variables
configure_env() {
  header "Step 2: Production Configuration & Credentials"

  local env_file=".env.prod"

  # Load existing .env.prod safely if present
  local prev_port=""
  local prev_provider=""
  local prev_pg_pass=""
  local prev_minimax_key=""
  local prev_deepseek_key=""
  local prev_qwen_key=""
  local prev_jwt_sec=""
  local prev_kms_key=""

  if [ -f "$env_file" ]; then
    info "Found existing $env_file. Settings will be preserved unless updated."
    prev_port="$(get_env_val PORT "$env_file")"
    prev_provider="$(get_env_val LLM_PROVIDER "$env_file")"
    prev_pg_pass="$(get_env_val POSTGRES_PASSWORD "$env_file")"
    prev_minimax_key="$(get_env_val MINIMAX_API_KEY "$env_file")"
    prev_deepseek_key="$(get_env_val DEEPSEEK_API_KEY "$env_file")"
    prev_qwen_key="$(get_env_val QWEN_API_KEY "$env_file")"
    prev_jwt_sec="$(get_env_val JWT_SECRET "$env_file")"
    prev_kms_key="$(get_env_val KMS_MASTER_KEY "$env_file")"
  fi

  if [ -z "$prev_port" ]; then prev_port="3001"; fi
  if [ -n "$APP_PORT_ARG" ]; then prev_port="$APP_PORT_ARG"; fi

  # 1. Port
  local app_port=""
  read_input "Public Web Port" app_port "$prev_port"

  # 2. Database password
  if [ -z "$prev_pg_pass" ]; then
    prev_pg_pass=$(generate_secret | cut -c 1-20)
  fi
  local pg_password=""
  read_secret "PostgreSQL Password" pg_password "$prev_pg_pass"

  # 3. AI Model Provider
  local selected_provider="$prev_provider"
  local minimax_key="$prev_minimax_key"
  local deepseek_key="$prev_deepseek_key"
  local qwen_key="$prev_qwen_key"

  if [ -n "$AI_PROVIDER_ARG" ]; then
    case "$AI_PROVIDER_ARG" in
      minimax) selected_provider="minimax" ;;
      deepseek) selected_provider="deepseek" ;;
      qwen) selected_provider="qwen" ;;
      demo|offline|none|"") selected_provider="" ;;
      *)
        warn "Unknown provider '$AI_PROVIDER_ARG', falling back to demo/offline mode."
        selected_provider=""
        ;;
    esac
  elif [ "$NON_INTERACTIVE" = false ]; then
    echo ""
    echo -e "  ${BOLD}Select AI Model Provider:${RESET}"
    echo -e "    ${BOLD}[1]${RESET} MiniMax ${DIM}(Anthropic Claude-compatible - Recommended for ISPs)${RESET}"
    echo -e "    ${BOLD}[2]${RESET} DeepSeek ${DIM}(OpenAI-compatible deepseek-chat)${RESET}"
    echo -e "    ${BOLD}[3]${RESET} Qwen / DashScope ${DIM}(Alibaba Cloud OpenAI-compatible)${RESET}"
    echo -e "    ${BOLD}[4]${RESET} Demo / Offline Mode ${DIM}(No AI API key needed, deterministic responses)${RESET}"
    
    local default_opt="1"
    if [ "$prev_provider" = "deepseek" ]; then default_opt="2"; fi
    if [ "$prev_provider" = "qwen" ]; then default_opt="3"; fi
    if [ -z "$prev_provider" ]; then default_opt="4"; fi

    local ai_choice=""
    read_input "Select option [1-4]" ai_choice "$default_opt"

    case "$ai_choice" in
      1)
        selected_provider="minimax"
        read_secret "Enter MiniMax API Key" minimax_key "$prev_minimax_key"
        ;;
      2)
        selected_provider="deepseek"
        read_secret "Enter DeepSeek API Key" deepseek_key "$prev_deepseek_key"
        ;;
      3)
        selected_provider="qwen"
        read_secret "Enter Qwen API Key" qwen_key "$prev_qwen_key"
        ;;
      *)
        selected_provider=""
        info "Running in demo/offline AI mode."
        ;;
    esac
  fi

  # 4. Cryptographic keys
  local jwt_sec="${prev_jwt_sec:-$(generate_secret)}"
  local kms_key="${prev_kms_key:-$(generate_secret)}"

  # 5. Encode database credentials for RFC 3986 connection string
  local encoded_pg_pass
  encoded_pg_pass="$(url_encode "$pg_password")"
  local database_url="postgresql://ftth:${encoded_pg_pass}@postgres:5432/ftth_copilot"

  # Write .env.prod
  cat > "$env_file" << EOF
# ==============================================================================
# FTTH-Copilot Production Environment
# Generated: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
# ==============================================================================

# Server
NODE_ENV=production
PORT=${app_port}

# Database
POSTGRES_USER=ftth
POSTGRES_PASSWORD=${pg_password}
POSTGRES_DB=ftth_copilot
DATABASE_URL=${database_url}

# Cryptographic Keys (32-byte secure hex)
JWT_SECRET=${jwt_sec}
KMS_MASTER_KEY=${kms_key}

# AI Provider
LLM_PROVIDER=${selected_provider}
MINIMAX_API_KEY=${minimax_key}
MINIMAX_BASE_URL=https://api.minimax.io/anthropic
MINIMAX_MODEL=MiniMax-M3

DEEPSEEK_API_KEY=${deepseek_key}
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
DEEPSEEK_MODEL=deepseek-chat

QWEN_API_KEY=${qwen_key}
QWEN_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
QWEN_MODEL=qwen-plus

# Connectors
SMARTOLT_USE_MOCK=true
SMARTOLT_API_BASE_URL=https://api.smartolt.com
SMARTOLT_API_KEY=

# Telemetry and Listeners
SNMP_RECEIVER_ENABLED=false
SNMP_UDP_PORT=1162
SYSLOG_RECEIVER_ENABLED=false
SYSLOG_UDP_PORT=5514
LOG_LEVEL=info
DEMO_MODE_ENABLED=true
EOF

  chmod 600 "$env_file"
  success "Wrote secure configuration to $env_file (permissions 0600)"
  APP_PORT="$app_port"
}

# Deploy containers
deploy_stack() {
  header "Step 3: Building and Starting Production Services"

  info "Building container images (multi-stage Next.js standalone)..."
  if ! $COMPOSE_CMD build; then
    error "Docker build failed. See logs above."
    exit 1
  fi

  info "Starting services in background..."
  if ! $COMPOSE_CMD up -d; then
    error "Docker compose up failed. See logs above."
    exit 1
  fi

  info "Waiting for application to report healthy status (polling http://127.0.0.1:${APP_PORT}/api/health)..."
  local attempts=0
  local max_attempts=40
  local app_healthy=false

  while [ $attempts -lt $max_attempts ]; do
    attempts=$((attempts + 1))
    if curl -s -f "http://127.0.0.1:${APP_PORT}/api/health" >/dev/null 2>&1; then
      app_healthy=true
      break
    fi
    sleep 2
  done

  if [ "$app_healthy" = true ]; then
    success "All services are up and healthy!"
  else
    error "Application health check failed: http://127.0.0.1:${APP_PORT}/api/health did not answer within 80s."
    info "Dumping container logs for troubleshooting:"
    $COMPOSE_CMD logs --tail 50 app || true
    $COMPOSE_CMD logs --tail 50 postgres || true
    $COMPOSE_CMD logs --tail 50 db-migrate || true
    exit 1
  fi

  # Run initial seed
  info "Seeding initial database roles and demo ISP data..."
  if ! $COMPOSE_CMD run --rm db-migrate pnpm --filter @ftth-copilot/db db:seed; then
    error "Database seeding failed. Services are running but seed data could not be populated."
    $COMPOSE_CMD logs --tail 30 postgres || true
    exit 1
  fi
  success "Database initialization complete."
}

# Print success completion
print_summary() {
  local server_ip
  server_ip=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "localhost")
  if [ -z "$server_ip" ]; then server_ip="localhost"; fi

  cat << EOF

${GREEN}╔═══════════════════════════════════════════════════════════════════╗
║${BOLD}          🎉 FTTH-Copilot Successfully Installed!                   ${RESET}${GREEN}║
╚═══════════════════════════════════════════════════════════════════╝${RESET}

  ${BOLD}Application URL:${RESET}   ${CYAN}http://${server_ip}:${APP_PORT}${RESET}
  ${BOLD}Local Access:${RESET}      ${CYAN}http://localhost:${APP_PORT}${RESET}
  ${BOLD}Health Check:${RESET}      ${CYAN}http://localhost:${APP_PORT}/api/health${RESET}

  ${BOLD}Default Credentials:${RESET}
    ${DIM}Tenant:${RESET}      Demo ISP (demo-tenant)
    ${DIM}Admin User:${RESET}  admin@ftth-copilot.local
    ${DIM}Password:${RESET}    (Generated during seed; see logs if not configured)

  ${BOLD}Management Commands:${RESET}
    View logs:       ${BOLD}${COMPOSE_CMD} logs -f app${RESET}
    Restart stack:   ${BOLD}${COMPOSE_CMD} restart${RESET}
    Stop stack:      ${BOLD}${COMPOSE_CMD} down${RESET}

EOF
}

main() {
  parse_args "$@"
  print_banner
  check_docker
  configure_env
  deploy_stack
  print_summary
}

main "$@"
