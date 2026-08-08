#!/bin/bash
# VaultLink Contract Upgrade Script for Stellar/Soroban (Bash/Linux/macOS version)
set -e

# Default values
NETWORK="testnet"
SOURCE="default"
CONTRACT_ID=""
WASM_PATH=""

# Parse arguments
while [[ "$#" -gt 0 ]]; do
    case $1 in
        --network) NETWORK="$2"; shift ;;
        --source) SOURCE="$2"; shift ;;
        --contract-id) CONTRACT_ID="$2"; shift ;;
        --wasm) WASM_PATH="$2"; shift ;;
        *) echo "Unknown parameter passed: $1"; exit 1 ;;
    esac
    shift
done

if [ -z "$CONTRACT_ID" ] || [ -z "$WASM_PATH" ]; then
    echo "Error: Parameters --contract-id and --wasm are required."
    echo "Usage: $0 --contract-id <contract_id> --wasm <wasm_path> [--network <network>] [--source <source>]"
    exit 1
fi

echo "=== 1. Installing New WASM Code ==="
WASM_HASH=$(stellar contract install --wasm "$WASM_PATH" --source "$SOURCE" --network "$NETWORK")
WASM_HASH=$(echo "$WASM_HASH" | tr -d '\r' | tr -d '\n')
echo "New WASM Code Hash: $WASM_HASH"

echo "=== 2. Invoking Upgrade on Contract $CONTRACT_ID ==="
stellar contract invoke --id "$CONTRACT_ID" --source "$SOURCE" --network "$NETWORK" -- upgrade --new_wasm_hash "$WASM_HASH"
echo "Upgrade Executed successfully!"
