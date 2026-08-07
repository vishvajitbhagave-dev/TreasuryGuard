# VaultLink Contract Upgrade Script for Stellar/Soroban
param (
    [string]$Network = "testnet",
    [string]$Source = "default",
    [string]$ContractId = "",
    [string]$WasmPath = ""
)

$ErrorActionPreference = "Stop"

if (-not $ContractId -or -not $WasmPath) {
    Write-Error "Parameters -ContractId and -WasmPath are required."
}

Write-Host "=== 1. Installing New WASM Code ===" -ForegroundColor Cyan
# This uploads the new WASM file and returns its 32-byte hex hash
$WasmHash = (stellar contract install --wasm $WasmPath --source $Source --network $Network).Trim()
Write-Host "New WASM Code Hash: $WasmHash" -ForegroundColor Green

Write-Host "=== 2. Invoking Upgrade on Contract $ContractId ===" -ForegroundColor Cyan
# Call the contract's upgrade function with the new WASM hash
$UpgradeTx = (stellar contract invoke --id $ContractId --source $Source --network $Network -- upgrade --new_wasm_hash $WasmHash)
Write-Host "Upgrade Executed! Transaction: $UpgradeTx" -ForegroundColor Green
