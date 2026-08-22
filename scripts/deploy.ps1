# VaultLink Deployment Script for Stellar/Soroban
param (
    [string]$Network = "testnet",
    [string]$Source = "default",
    [string]$AdminAddress = "",
    [string]$TokenAddress = "",
    [string]$MemberAddress = ""
)

$ErrorActionPreference = "Stop"

Write-Host "=== 1. Building Smart Contracts ===" -ForegroundColor Cyan
Set-Location "$PSScriptRoot\..\contracts"
stellar contract build

Write-Host "=== 2. Deploying Registry Contract ===" -ForegroundColor Cyan
$RegistryWasm = "$PSScriptRoot\..\contracts\target\wasm32v1-none\release\vault_registry.wasm"
$RegistryId = (stellar contract deploy --wasm $RegistryWasm --source $Source --network $Network).Trim()
Write-Host "Registry Contract ID: $RegistryId" -ForegroundColor Green

Write-Host "=== 3. Deploying Vault Contract ===" -ForegroundColor Cyan
$VaultWasm = "$PSScriptRoot\..\contracts\target\wasm32v1-none\release\vault_core.wasm"
$VaultId = (stellar contract deploy --wasm $VaultWasm --source $Source --network $Network).Trim()
Write-Host "Vault Contract ID: $VaultId" -ForegroundColor Green

# Use AdminAddress or try to find it from source
if (-not $AdminAddress) {
    # Attempt to resolve admin address via stellar CLI keys
    $AdminAddress = (stellar keys address $Source).Trim()
}
Write-Host "Admin Address: $AdminAddress" -ForegroundColor Green

# If no token address is provided, we can deploy a mock Stellar Asset Contract
if (-not $TokenAddress) {
    Write-Host "=== No Token Address provided, deploying Mock Asset (SAC) ===" -ForegroundColor Yellow
    # Create a mock asset using stellar contract asset deploy
    $TokenAddress = (stellar contract asset deploy --asset "USDC:$AdminAddress" --source $Source --network $Network).Trim()
    Write-Host "Mock USDC Token Contract ID: $TokenAddress" -ForegroundColor Green
}

Write-Host "=== 4. Initializing Registry Contract ===" -ForegroundColor Cyan
# fn initialize(env: Env, admin: Address)
$RegistryInitTx = (stellar contract invoke --id $RegistryId --source $Source --network $Network -- initialize --admin $AdminAddress)
Write-Host "Registry Initialized: $RegistryInitTx" -ForegroundColor Green

Write-Host "=== 5. Initializing Vault Contract ===" -ForegroundColor Cyan
# fn initialize(env: Env, admin: Address, token: Address, registry: Address, threshold: u32,
#               members: Vec<Address>, roles: Vec<String>, name: String, purpose: String)
# For simplicity, initialized with admin and another member as initial vault members
$MembersArr = @($AdminAddress)
$RolesArr = @("owner")
if ($MemberAddress) {
    $MembersArr = @($AdminAddress, $MemberAddress)
    $RolesArr = @("owner", "contributor")
    Write-Host "Adding Member Address to vault: $MemberAddress" -ForegroundColor Green
}
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$MembersFile = "$PSScriptRoot\members.json"
$RolesFile = "$PSScriptRoot\roles.json"
[System.IO.File]::WriteAllText($MembersFile, ($MembersArr | ConvertTo-Json -Compress), $Utf8NoBom)
[System.IO.File]::WriteAllText($RolesFile, ($RolesArr | ConvertTo-Json -Compress), $Utf8NoBom)

$VaultInitTx = (stellar contract invoke --id $VaultId --source $Source --network $Network -- initialize --admin $AdminAddress --token $TokenAddress --registry $RegistryId --threshold 1 --members-file-path $MembersFile --roles-file-path $RolesFile --name "Team Treasury" --purpose "Shared multi-sig fund for group expenses")

if (Test-Path $MembersFile) {
    Remove-Item $MembersFile
}
if (Test-Path $RolesFile) {
    Remove-Item $RolesFile
}
Write-Host "Vault Initialized: $VaultInitTx" -ForegroundColor Green

# Write outputs to a configuration file for the frontend
$Metadata = @{
    network = $Network
    registry_id = $RegistryId
    vault_id = $VaultId
    token_id = $TokenAddress
    admin_address = $AdminAddress
    timestamp = (Get-Date -Format "o")
} | ConvertTo-Json

$OutputDir = "$PSScriptRoot\..\frontend\src\config"
if (-not (Test-Path $OutputDir)) {
    New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
}
$OutputFile = "$OutputDir\contracts.json"
[System.IO.File]::WriteAllText($OutputFile, $Metadata, $Utf8NoBom)
Write-Host "Configuration saved to frontend/src/config/contracts.json!" -ForegroundColor Green
