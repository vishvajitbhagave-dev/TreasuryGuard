# 🔐 VaultLink

VaultLink is a premium, secure, and production-ready **multi-signature treasury dashboard** powered by **Stellar Soroban smart contracts**. It enforces threshold-based signing protocols for decentralized team fund management, real-time activity tracking, and registry catalogs.

This repository is fully compliant with **Level 3 Smart Contract & Web Application Developer specifications**, featuring advanced on-chain programming, inter-contract messages, real-time sync engines, comprehensive test suites, Docker hosting setups, and automated CI/CD pipelines.

### 🌐 Live Demo

🔗 **Live App:** [https://treasury-guard.vercel.app](https://treasury-guard.vercel.app/)

---

## 🏗️ Architecture Design & Flows

VaultLink employs a decoupled multi-contract architecture to optimize upgradability, access governance, and indexing:

1. **Vault Registry Contract (`vault_registry`)**: Acts as a central catalog. It keeps record of all active vaults, accumulates transaction volumes, logs core activities, and can be upgraded securely by the administrator.
2. **Vault Core Contract (`vault_core`)**: Manages the treasury funds (using Stellar Asset Contracts - SAC). It holds USDC reserves, accepts deposits, registers multi-sig members, manages pending spending proposals, gathers threshold approvals, and executes withdrawals upon reaching the required signers limit.

### Inter-Contract Communication Flow

On-chain operations require the Vault Core contract to message the Vault Registry contract. The sequence diagram below maps this workflow:

```mermaid
sequenceDiagram
    autonumber
    actor Admin as Owner/Admin
    actor Member as Team Signer
    participant VC as Vault Core Contract
    participant VR as Vault Registry Contract
    participant SAC as Stellar Asset Contract

    Admin->>VC: initialize(admin, token, registry, threshold, members)
    activate VC
    VC->>VR: register_vault(vault_address)
    Note over VR: Registers Vault in on-chain registry catalog
    deactivate VC

    Member->>VC: deposit(amount)
    activate VC
    VC->>SAC: transfer(from, vault, amount)
    VC->>VR: log_activity(depositor, "deposit")
    Note over VR: Activity logged central registry
    deactivate VC

    Member->>VC: submit_request(recipient, amount, description)
    activate VC
    VC->>VR: log_activity(proposer, "submit_request")
    VC-->>Member: returns request_id (Pending)
    deactivate VC

    Member->>VC: approve_request(request_id)
    activate VC
    VC->>VR: log_activity(approver, "approve_request")
    deactivate VC

    Note over VC: When approval_count >= threshold
    Member->>VC: execute_request(request_id)
    activate VC
    VC->>SAC: transfer(vault, recipient, amount)
    VC->>VR: log_activity(executor, "execute_request")
    Note over VC: Request status -> Executed
    deactivate VC
```

---

## 🏆 Level 3 Compliance Checklist

| Requirement | Implementation Details | Status |
| :--- | :--- | :---: |
| **Advanced smart contract development** | Implemented Rust Soroban contract with custom structs (`SpendingRequest`), persistent storage keys, panic-safe error handling, and WASM upgrade interfaces (`update_current_contract_wasm`). | **Completed** |
| **Inter-contract communication** | Vault Core imports `RegistryInterface` and executes inter-contract calls via `RegistryClient` to register itself and log structured transaction metadata in real-time. | **Completed** |
| **Event streaming & real-time updates** | Next.js polls Soroban RPC event logs (`getEvents`) every 10s on Testnet. Sandbox mode simulates background signers activity using a `setInterval` simulator, pushing alerts to the dashboard. | **Completed** |
| **CI/CD pipeline setup** | Created GitHub Actions workflow `.github/workflows/ci.yml` that builds and runs unit tests for both Rust smart contracts and TypeScript Next.js web application. | **Completed** |
| **Smart contract deployment workflow** | Added cross-platform deployment bash scripts (`deploy.sh`, `upgrade.sh`) mirroring Windows PowerShell scripts (`deploy.ps1`, `upgrade.ps1`) to compile and deploy on Testnet. | **Completed** |
| **Mobile responsive frontend** | Fully responsive Tailwind layout supporting custom dark palettes, hover micro-animations (`glass-panel-hover`), and dynamic layout shifts for mobile views. | **Completed** |
| **Error handling & loading states** | Implemented inputs validation (Stellar address regex, balance checks) and button state loaders with disabling attributes (`loadingAction` state machine). | **Completed** |
| **Writing tests for contracts and frontend** | Rust smart contracts are tested using native mocking utilities in `lib.rs`. Next.js frontend has complete test coverage using `Vitest` and `jsdom` testing engine. | **Completed** |
| **Production-ready architecture** | Dockerized the Next.js app with multi-stage build optimization (`Dockerfile`) and configured orchestrator scripts (`docker-compose.yml`) for local scaling. | **Completed** |
| **Documentation & presentation** | Created a comprehensive root architecture diagram (Mermaid), API descriptions, local execution parameters, and requirements mappings. | **Completed** |

---

## 🔗 Deployed Contracts (Stellar Testnet)

All contracts are deployed on **Stellar Testnet**. Addresses are auto-loaded from `frontend/src/config/contracts.json`.

| Contract | Address |
| :--- | :--- |
| **Vault Core** | `CDVT4VF4UN6TXRSBD4UJGP3P26KJBWWYLWVLX23WMJXBLHDFZGMBNGQO` |
| **Vault Registry** | `CBWTE3MLUVQMD6BMTTVJPBPCI4LFIM5CFZNKR2LRWKSJ7ZLAL5ZACAB2` |
| **SAC Token (USDC)** | `CDT3PKODYDZDCDXJLO3PZ56GARG5SIDCDEEDTU7EBGPW3EITKCOWQOXW` |

> **Admin/Owner address:** `GACYFFEF6TV4MNCRW5LYZ57PO6V3CAVZMGYBEHD4MG6IPYVXENE4XJQO`
>
> **WASM hashes:** Vault Core `3cd0d9f25f299c8781a2c78dc70a8cc067f917065e9ef26f3ee20c7c80aab4c2` · Vault Registry `bd502a6bdf67a9261f6d1f6f49806d50b3e7c34d5c261b0d75f7b77931f6bbcc`
>
> This deployment includes the full Community Management feature set (request receipts, on-chain discussion comments, monthly contribution tracking, role-based member invitations, CSV exports) **plus** the Nice-to-Have features: recurring contributions via SAC allowance pulls (`set_contribution_plan`, `run_due_contributions`) and per-category monthly budget caps enforced at request submission (`CategoryBudgetExceeded`).

---

## 📸 Screenshots

### Wallet Selector (Multi-Wallet Support)

![Wallet Selector](frontend/public/wallet-selector.png)

### Mobile Responsive UI

![Mobile Responsive](frontend/public/mobile-responsive.png)

### CI/CD Pipeline (GitHub Actions)

![CI/CD Pipeline](frontend/public/ci-pipeline.png)

### Test Output

![Test Output](frontend/public/test-output.png)

---

## 🔗 Verified Transactions

All transactions below are live on **Stellar Testnet** and verifiable on [Stellar Expert](https://stellar.expert/explorer/testnet).

- [Vault Core Initialize TX](https://stellar.expert/explorer/testnet/tx/80eea5ce78ab0d5d17d64129037da64a1a2fa73c7fe4919be9e997e09de96804) — contract call initializing Vault Core with admin, USDC token, registry, signing threshold, member roles, vault name and purpose (Aug 22, 2026)
- [Vault Registry Initialize TX](https://stellar.expert/explorer/testnet/tx/726a1022690fc388cddf226e48c68bfbc336206810a0603588cb404bcca85325) — contract call initializing the Vault Registry admin (Aug 22, 2026)
- [Vault Registration TX](https://stellar.expert/explorer/testnet/tx/80eea5ce78ab0d5d17d64129037da64a1a2fa73c7fe4919be9e997e09de96804) — inter-contract call: Vault Core registered itself with the Vault Registry on initialization, emitting the `vault_registered` event (Aug 22, 2026)
- [Emergency Pause TX](https://stellar.expert/explorer/testnet/tx/84e9d5ea7f5b97cbabeeb4a15ad440a2b1504934ea0266bca73dc02480e936ce) — Owner activated the emergency pause (`set_paused`), blocking withdrawals on-chain; followed by a resume transaction restoring normal operation (Aug 22, 2026)
- [Community Features Redeploy TX](https://stellar.expert/explorer/testnet/tx/e35c6f6d014f5e5ca26bca78b913f6f9663129f8670108eea8413995236b0995) — initialize of the upgraded Vault Core (receipts, comments, contribution tracking) with registry self-registration (`vault_registered` event) (Aug 22, 2026)
- [Nice-to-Have Redeploy TX](https://stellar.expert/explorer/testnet/tx/e493b2f65a50cf322f46ccde17dfac790ba05b7f437e839b43be905509ce17d5) — initialize of the current Vault Core (recurring contributions + budget caps) with registry self-registration (Aug 22, 2026)
- [Budget Cap Rules TX](https://stellar.expert/explorer/testnet/tx/fb94f949c7362700e95d6ac8ee8a70242829ea47bf793c1ec5b17d129af41acd) — Owner set rules incl. `category_caps` Repairs = 300 USDC/month and `monthly_target` = 100 USDC; a 400 USDC Repairs request was rejected with `CategoryBudgetExceeded (#14)` (Aug 22, 2026)
- [Member Invite TX](https://stellar.expert/explorer/testnet/tx/d8b484ee2ac491b6e90c50c42dcda7efb50a54526053857fd64f3ae3cd56be0c) — new member added as Contributor via `set_member_role` on the live deployment (Aug 22, 2026)
- [Recurring Plan TX](https://stellar.expert/explorer/testnet/tx/225650f5942a061691356e182dd4456aabaf7ded43286cb3ae2cbad71b7a5b72) — member registered a 20 USDC/month plan after granting the vault a token allowance ([approve TX](https://stellar.expert/explorer/testnet/tx/a9e80d8c6f09df0dfb8c03759e10caefe2854c0f0415507a46edbb9cc4e1fd6a)) (Aug 22, 2026)
- [Auto-Contribution Pull TX](https://stellar.expert/explorer/testnet/tx/ac732b3a34e4074083925000a5c4497dce9b1dd9112fac66555115917fe667e9) — `run_due_contributions` pulled the due charge from the member's allowance into the vault (`auto_contribution` event); `get_contribution(member, period)` confirms the amount, `last_period` prevents double-charging (Aug 22, 2026)

---

## 🎬 Demo Video

<!-- TODO: Record a 1–2 minute screen recording covering:
     0:00–0:10  — Intro: show the landing page, explain it's a multi-sig vault on Stellar
     0:10–0:25  — Connect Wallet: click Connect, show multi-wallet dropdown, connect with Freighter
     0:25–0:40  — Dashboard overview: show vault balance, token balance, stat cards
     0:40–0:55  — Deposit: enter amount, click Deposit, show spinner → success notification with tx hash
     0:55–1:10  — Submit Proposal: fill recipient/amount/description, submit, show it appear in the Requests list
     1:10–1:25  — Approve & Execute: click Approve (show threshold update), click Execute (show final tx)
     1:25–1:40  — Real-time events: point out the Activity Log updating live
     1:40–2:00  — Wrap up: show network toggle (Simulation ↔ Testnet), mobile responsive view

     Record with OBS Studio (free) or use https://screenrec.com for browser recording.
     Upload to YouTube (unlisted) or Loom, then paste the link below.
-->
🔗 **Demo Video:** _Recording pending — [record with Loom](https://loom.com) or OBS Studio_

---

## 🚀 Getting Started

### Prerequisites

Ensure you have the following installed:
- [Rust](https://www.rust-lang.org/) & `wasm32-unknown-unknown` target.
- [Node.js v20+](https://nodejs.org/).
- [Stellar CLI](https://developers.stellar.org/docs/build/smart-contracts/getting-started/setup) (for contract deployments).

---

### 1. Clone the Repository

```bash
git clone https://github.com/vishvajitbhagave-dev/TreasuryGuard.git
cd TreasuryGuard
```

---

### 2. Environment Variables

No `.env` file is required for local development. All configuration is handled through:

- **Smart contracts**: Deployed contract addresses are auto-generated into `frontend/src/config/contracts.json` by the deployment scripts.
- **Network**: The app defaults to Simulation mode. Switch to Stellar Testnet via the toggle in the header — no RPC URL configuration needed.

If you deploy your own contracts, the deploy scripts automatically update `frontend/src/config/contracts.json`.

---

### 3. Smart Contract Development & Testing

The contracts live in the `/contracts` directory.

- **Compile Contracts**:
  ```bash
  cd contracts
  stellar contract build
  ```

- **Run Smart Contract Unit Tests**:
  ```bash
  cargo test --manifest-path Cargo.toml
  ```

---

### 4. Frontend Development & Testing

The dashboard is built using Next.js 16/React 19 and Tailwind CSS.

- **Install Frontend Dependencies**:
  ```bash
  cd frontend
  npm install
  ```

- **Run Dev Server Locally**:
  ```bash
  npm run dev
  ```
  Access the dashboard at `http://localhost:3000`.

- **Run Frontend Unit Tests**:
  ```bash
  npm run test
  ```
  Runs 11 test cases across the simulation state manager and component structures.

---

### 5. Deploying & Upgrading Contracts

Deployment configuration is saved automatically to the frontend (`frontend/src/config/contracts.json`).

- **Deploy (macOS/Linux/Bash)**:
  ```bash
  ./scripts/deploy.sh --network testnet --source default
  ```

- **Deploy (Windows/PowerShell)**:
  ```powershell
  .\scripts\deploy.ps1 -Network testnet -Source default
  ```

- **Upgrade (macOS/Linux/Bash)**:
  ```bash
  ./scripts/upgrade.sh --contract-id <CONTRACT_ID> --wasm <WASM_PATH> --network testnet
  ```

- **Upgrade (Windows/PowerShell)**:
  ```powershell
  .\scripts\upgrade.ps1 -ContractId <CONTRACT_ID> -WasmPath <WASM_PATH> -Network testnet
  ```

---

### 6. Running with Docker (Production Ready)

To build and run the Next.js application inside a lightweight optimized production Docker container:

- **Build and Run**:
  ```bash
  docker-compose up --build
  ```
  This maps the optimized container port to `http://localhost:3000`.

- **Stop Container**:
  ```bash
  docker-compose down
  ```
