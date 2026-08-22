#!/bin/bash
# VaultLink Deployment Script for Stellar/Soroban (Bash/Linux/macOS version)
set -e

# Default values
NETWORK="testnet"
SOURCE="default"
ADMIN_ADDRESS=""
TOKEN_ADDRESS=""
MEMBER_ADDRESS=""

# Parse arguments
while [[ "$#" -gt 0 ]]; do
    case $1 in
        --network) NETWORK="$2"; shift ;;
        --source) SOURCE="$2"; shift ;;
        --admin) ADMIN_ADDRESS="$2"; shift ;;
        --token) TOKEN_ADDRESS="$2"; shift ;;
        --member) MEMBER_ADDRESS="$2"; shift ;;
        *) echo "Unknown parameter passed: $1"; exit 1 ;;
    esac
    shift
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"

echo "=== 1. Building Smart Contracts ==="
cd "$SCRIPT_DIR/../contracts"
stellar contract build

echo "=== 2. Deploying Registry Contract ==="
REGISTRY_WASM="$SCRIPT_DIR/../contracts/target/wasm32-unknown-unknown/release/vault_registry.wasm"
if [ ! -f "$REGISTRY_WASM" ]; then
    # Fallback to the target directory used by deploy.ps1
    REGISTRY_WASM="$SCRIPT_DIR/../contracts/target/wasm32v1-none/release/vault_registry.wasm"
fi

REGISTRY_ID=$(stellar contract deploy --wasm "$REGISTRY_WASM" --source "$SOURCE" --network "$NETWORK")
REGISTRY_ID=$(echo "$REGISTRY_ID" | tr -d '\r' | tr -d '\n')
echo "Registry Contract ID: $REGISTRY_ID"

echo "=== 3. Deploying Vault Contract ==="
VAULT_WASM="$SCRIPT_DIR/../contracts/target/wasm32-unknown-unknown/release/vault_core.wasm"
if [ ! -f "$VAULT_WASM" ]; then
    # Fallback to the target directory used by deploy.ps1
    VAULT_WASM="$SCRIPT_DIR/../contracts/target/wasm32v1-none/release/vault_core.wasm"
fi

VAULT_ID=$(stellar contract deploy --wasm "$VAULT_WASM" --source "$SOURCE" --network "$NETWORK")
VAULT_ID=$(echo "$VAULT_ID" | tr -d '\r' | tr -d '\n')
echo "Vault Contract ID: $VAULT_ID"

# Resolve admin address if not provided
if [ -z "$ADMIN_ADDRESS" ]; then
    ADMIN_ADDRESS=$(stellar keys address "$SOURCE")
    ADMIN_ADDRESS=$(echo "$ADMIN_ADDRESS" | tr -d '\r' | tr -d '\n')
fi
echo "Admin Address: $ADMIN_ADDRESS"

# Deploy Mock USDC if not provided
if [ -z "$TOKEN_ADDRESS" ]; then
    echo "=== No Token Address provided, deploying Mock Asset (SAC) ==="
    TOKEN_ADDRESS=$(stellar contract asset deploy --asset "USDC:$ADMIN_ADDRESS" --source "$SOURCE" --network "$NETWORK")
    TOKEN_ADDRESS=$(echo "$TOKEN_ADDRESS" | tr -d '\r' | tr -d '\n')
    echo "Mock USDC Token Contract ID: $TOKEN_ADDRESS"
fi

echo "=== 4. Initializing Registry Contract ==="
stellar contract invoke --id "$REGISTRY_ID" --source "$SOURCE" --network "$NETWORK" -- initialize --admin "$ADMIN_ADDRESS"
echo "Registry Initialized!"

echo "=== 5. Initializing Vault Contract ==="
MEMBERS_FILE="$SCRIPT_DIR/members.json"
ROLES_FILE="$SCRIPT_DIR/roles.json"

if [ -n "$MEMBER_ADDRESS" ]; then
    echo "Adding Member Address to vault: $MEMBER_ADDRESS"
    echo "[\"$ADMIN_ADDRESS\", \"$MEMBER_ADDRESS\"]" > "$MEMBERS_FILE"
    echo '["owner", "contributor"]' > "$ROLES_FILE"
else
    echo "[\"$ADMIN_ADDRESS\"]" > "$MEMBERS_FILE"
    echo '["owner"]' > "$ROLES_FILE"
fi

stellar contract invoke --id "$VAULT_ID" --source "$SOURCE" --network "$NETWORK" -- initialize --admin "$ADMIN_ADDRESS" --token "$TOKEN_ADDRESS" --registry "$REGISTRY_ID" --threshold 1 --members-file-path "$MEMBERS_FILE" --roles-file-path "$ROLES_FILE" --name "Team Treasury" --purpose "Shared multi-sig fund for group expenses"

if [ -f "$MEMBERS_FILE" ]; then
    rm "$MEMBERS_FILE"
fi
if [ -f "$ROLES_FILE" ]; then
    rm "$ROLES_FILE"
fi
echo "Vault Initialized!"

# Write outputs to a configuration file for the frontend
OUTPUT_DIR="$SCRIPT_DIR/../frontend/src/config"
mkdir -p "$OUTPUT_DIR"
OUTPUT_FILE="$OUTPUT_DIR/contracts.json"

cat <<EOF > "$OUTPUT_FILE"
{
  "network": "$NETWORK",
  "registry_id": "$REGISTRY_ID",
  "vault_id": "$VAULT_ID",
  "token_id": "$TOKEN_ADDRESS",
  "admin_address": "$ADMIN_ADDRESS",
  "timestamp": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
}
EOF

echo "Configuration saved to frontend/src/config/contracts.json!"
