"use client";

import { useState, useEffect } from "react";
import { 
  VaultConfig, 
  SpendingRequest, 
  ActivityLog, 
  NetworkMode, 
  WalletState 
} from "./types";
import { 
  getSimulationState, 
  simulatedDeposit, 
  simulatedSubmitRequest, 
  simulatedApproveRequest, 
  simulatedExecuteRequest, 
  simulatedCancelRequest, 
  resetSimulation,
  SIM_ACCOUNTS,
  SimState
} from "./simulation";
import { 
  connectWallet, 
  isFreighterInstalled, 
  CONTRACTS,
  depositToVault,
  submitRequestToVault,
  approveRequestInVault,
  executeRequestInVault,
  cancelRequestInVault,
  establishTrustline,
  fetchVaultBalance,
  fetchContractRequests,
  fetchTokenBalance,
  fetchContractConfig
} from "./stellar";

export default function Home() {
  // Network Mode
  const [networkMode, setNetworkMode] = useState<NetworkMode>("simulation");
  const [activeSimUser, setActiveSimUser] = useState<string>(SIM_ACCOUNTS.ALICE);
  
  // App states loaded from simulation or stellar
  const [config, setConfig] = useState<VaultConfig>({
    admin: "",
    token: "",
    registry: "",
    threshold: 0
  });
  const [requests, setRequests] = useState<SpendingRequest[]>([]);
  const [activities, setActivities] = useState<ActivityLog[]>([]);
  const [vaultBalance, setVaultBalance] = useState<string>("0");
  const [userBalances, setUserBalances] = useState<{ [address: string]: string }>({});

  // Wallet connection state (for Testnet)
  const [wallet, setWallet] = useState<WalletState>({
    address: null,
    balance: "0",
    isConnected: false,
    error: null
  });

  // Action status / Notifications
  const [notification, setNotification] = useState<{ type: "success" | "error" | "info"; message: string } | null>(null);
  
  // Forms State
  const [depositAmount, setDepositAmount] = useState<string>("");
  const [newRequest, setNewRequest] = useState({
    recipient: "",
    amount: "",
    description: ""
  });
  
  // Loading animations
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [isFreighterAvailable, setIsFreighterAvailable] = useState<boolean>(false);

  // Check Freighter availability on load
  useEffect(() => {
    isFreighterInstalled().then(setIsFreighterAvailable);
  }, []);

  // Fetch / Sync State based on Network Mode
  const syncState = async () => {
    if (networkMode === "simulation") {
      const state: SimState = getSimulationState();
      setConfig(state.config);
      setRequests(state.requests);
      setActivities(state.activities);
      setVaultBalance(state.balance);
      setUserBalances(state.userBalances);
    } else {
      // Testnet Mode: load configs from contract
      try {
        const liveConfig = await fetchContractConfig(CONTRACTS.vaultId);
        setConfig(liveConfig);
        
        const balance = await fetchVaultBalance(CONTRACTS.vaultId);
        setVaultBalance(balance);
        
        const liveRequests = await fetchContractRequests(CONTRACTS.vaultId);
        setRequests(liveRequests);
        
        if (wallet.address) {
          const tokenBal = await fetchTokenBalance(CONTRACTS.tokenId, wallet.address);
          setWallet(w => ({ ...w, balance: tokenBal }));
        }
        
        setActivities([
          {
            id: "t1",
            timestamp: Date.now() - 3600000 * 6,
            type: "vault_registered",
            user: CONTRACTS.vaultId,
            details: "Deployed and registered contract on Stellar Testnet"
          }
        ]);
      } catch (err) {
        console.error("Error syncing testnet state:", err);
      }
    }
  };

  useEffect(() => {
    syncState();
  }, [networkMode, wallet.address]);

  // Flash Notification helper
  const triggerNotification = (type: "success" | "error" | "info", message: string) => {
    setNotification({ type, message });
    setTimeout(() => {
      setNotification(null);
    }, 5000);
  };

  // Switch Simulated Member User
  const handleUserChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setActiveSimUser(e.target.value);
    triggerNotification("info", `Switched active simulation member to ${getAccountLabel(e.target.value)}`);
  };

  // Helper to format addresses or names
  const getAccountLabel = (addr: string) => {
    if (!addr) return "Unknown";
    if (addr === SIM_ACCOUNTS.ADMIN) return "Admin (Contract Owner)";
    if (addr === SIM_ACCOUNTS.ALICE) return "Alice (Member)";
    if (addr === SIM_ACCOUNTS.BOB) return "Bob (Member)";
    if (addr === SIM_ACCOUNTS.CHARLIE) return "Charlie (Member)";
    if (addr === SIM_ACCOUNTS.RECIPIENT) return "Recipient Merchant";
    return `${addr.substring(0, 6)}...${addr.substring(addr.length - 4)}`;
  };

  const getSimulatedUserBalance = () => {
    return userBalances[activeSimUser] || "0";
  };

  // Connect Freighter Wallet
  const handleConnectWallet = async () => {
    setLoadingAction("connect_wallet");
    try {
      const pubKey = await connectWallet();
      let liveBalance = "0";
      try {
        liveBalance = await fetchTokenBalance(CONTRACTS.tokenId, pubKey);
      } catch (e) {
        console.error("Failed to fetch token balance on connection:", e);
      }
      setWallet({
        address: pubKey,
        balance: liveBalance,
        isConnected: true,
        error: null
      });
      triggerNotification("success", "Successfully connected Freighter wallet!");
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      setWallet(w => ({ ...w, error: errorMsg }));
      triggerNotification("error", errorMsg);
    } finally {
      setLoadingAction(null);
    }
  };

  // Disconnect Wallet
  const handleDisconnectWallet = () => {
    setWallet({
      address: null,
      balance: "0",
      isConnected: false,
      error: null
    });
    triggerNotification("info", "Wallet disconnected.");
  };

  // Trustline Action
  const handleEstablishTrustline = async () => {
    if (!wallet.address) {
      triggerNotification("error", "Please connect Freighter wallet first.");
      return;
    }
    setLoadingAction("establish_trustline");
    try {
      const txHash = await establishTrustline(wallet.address);
      triggerNotification("success", `Trustline established! Tx Hash: ${txHash.substring(0, 12)}...`);
    } catch (err: any) {
      triggerNotification("error", err.message || String(err));
    } finally {
      setLoadingAction(null);
    }
  };

  // Faucet Action
  const handleRequestFaucet = async () => {
    if (!wallet.address) {
      triggerNotification("error", "Please connect Freighter wallet first.");
      return;
    }
    setLoadingAction("request_faucet");
    try {
      const res = await fetch("/api/faucet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: wallet.address })
      });
      const data = await res.json();
      if (data.error) {
        throw new Error(data.error);
      }
      triggerNotification("success", `Faucet success: ${data.message}`);
      syncState();
    } catch (err: any) {
      triggerNotification("error", err.message || String(err));
    } finally {
      setLoadingAction(null);
    }
  };

  // Reset Simulation State
  const handleResetSimulation = () => {
    resetSimulation();
    syncState();
    triggerNotification("info", "Simulation environment reset to default state.");
  };

  // Deposit Actions
  const handleDeposit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!depositAmount || parseFloat(depositAmount) <= 0) {
      triggerNotification("error", "Please enter a valid deposit amount.");
      return;
    }

    const amount = depositAmount;
    setLoadingAction("deposit");

    try {
      if (networkMode === "simulation") {
        const userBal = parseFloat(getSimulatedUserBalance());
        if (userBal < parseFloat(amount)) {
          triggerNotification("error", "Insufficient funds in simulated wallet.");
          setLoadingAction(null);
          return;
        }
        simulatedDeposit(activeSimUser, parseFloat(amount));
        syncState();
        setDepositAmount("");
        triggerNotification("success", `Deposited ${amount} USDC into the vault!`);
      } else {
        if (!wallet.address) {
          triggerNotification("error", "Please connect Freighter wallet first.");
          setLoadingAction(null);
          return;
        }
        const txHash = await depositToVault(CONTRACTS.vaultId, amount, wallet.address);
        triggerNotification("success", `Deposit successful! Tx Hash: ${txHash.substring(0, 12)}...`);
        setDepositAmount("");
        syncState();
      }
    } catch (err: any) {
      triggerNotification("error", err.message || String(err));
    } finally {
      setLoadingAction(null);
    }
  };

  // Submit Request Action
  const handleSubmitRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRequest.recipient || !newRequest.amount || !newRequest.description) {
      triggerNotification("error", "All fields are required to submit a spending request.");
      return;
    }
    const amountVal = parseFloat(newRequest.amount);
    if (amountVal <= 0) {
      triggerNotification("error", "Amount must be positive.");
      return;
    }

    setLoadingAction("submit_request");

    try {
      if (networkMode === "simulation") {
        simulatedSubmitRequest(
          activeSimUser,
          newRequest.recipient,
          amountVal,
          newRequest.description
        );
        syncState();
        setNewRequest({ recipient: "", amount: "", description: "" });
        triggerNotification("success", "Spending request submitted successfully!");
      } else {
        if (!wallet.address) {
          triggerNotification("error", "Please connect Freighter wallet first.");
          setLoadingAction(null);
          return;
        }
        const txHash = await submitRequestToVault(
          CONTRACTS.vaultId,
          wallet.address,
          newRequest.recipient,
          newRequest.amount,
          newRequest.description
        );
        triggerNotification("success", `Request submitted! Tx Hash: ${txHash.substring(0, 12)}...`);
        setNewRequest({ recipient: "", amount: "", description: "" });
        syncState();
      }
    } catch (err: any) {
      triggerNotification("error", err.message || String(err));
    } finally {
      setLoadingAction(null);
    }
  };

  // Approve Request Action
  const handleApproveRequest = async (id: number) => {
    setLoadingAction(`approve_${id}`);
    try {
      if (networkMode === "simulation") {
        const sessionKey = `approved_${id}_${activeSimUser}`;
        const alreadyApproved = localStorage.getItem(sessionKey);
        
        if (alreadyApproved) {
          triggerNotification("error", "You have already approved this spending request.");
          setLoadingAction(null);
          return;
        }

        simulatedApproveRequest(activeSimUser, id);
        syncState();
        triggerNotification("success", `Approved request #${id}`);
      } else {
        if (!wallet.address) {
          triggerNotification("error", "Please connect Freighter wallet first.");
          setLoadingAction(null);
          return;
        }
        const txHash = await approveRequestInVault(CONTRACTS.vaultId, wallet.address, id);
        triggerNotification("success", `Request #${id} approved! Tx Hash: ${txHash.substring(0, 12)}...`);
        syncState();
      }
    } catch (err: any) {
      triggerNotification("error", err.message || String(err));
    } finally {
      setLoadingAction(null);
    }
  };

  // Execute Request Action
  const handleExecuteRequest = async (id: number) => {
    setLoadingAction(`execute_${id}`);
    try {
      if (networkMode === "simulation") {
        const stateBefore = getSimulationState();
        const req = stateBefore.requests.find(r => r.id === id);
        if (!req) return;

        if (parseFloat(stateBefore.balance) < parseFloat(req.amount)) {
          triggerNotification("error", "Insufficient Vault balance to execute this payment.");
          simulatedExecuteRequest(activeSimUser, id); // Will log failure
          syncState();
          setLoadingAction(null);
          return;
        }

        simulatedExecuteRequest(activeSimUser, id);
        syncState();
        triggerNotification("success", `Request #${id} executed! Funds transferred successfully.`);
      } else {
        if (!wallet.address) {
          triggerNotification("error", "Please connect Freighter wallet first.");
          setLoadingAction(null);
          return;
        }
        const txHash = await executeRequestInVault(CONTRACTS.vaultId, wallet.address, id);
        triggerNotification("success", `Request #${id} executed! Tx Hash: ${txHash.substring(0, 12)}...`);
        syncState();
      }
    } catch (err: any) {
      triggerNotification("error", err.message || String(err));
    } finally {
      setLoadingAction(null);
    }
  };

  // Cancel Request Action
  const handleCancelRequest = async (id: number) => {
    setLoadingAction(`cancel_${id}`);
    try {
      if (networkMode === "simulation") {
        simulatedCancelRequest(activeSimUser, id);
        syncState();
        triggerNotification("success", `Request #${id} cancelled.`);
      } else {
        if (!wallet.address) {
          triggerNotification("error", "Please connect Freighter wallet first.");
          setLoadingAction(null);
          return;
        }
        const txHash = await cancelRequestInVault(CONTRACTS.vaultId, wallet.address, id);
        triggerNotification("success", `Request #${id} cancelled! Tx Hash: ${txHash.substring(0, 12)}...`);
        syncState();
      }
    } catch (err: any) {
      triggerNotification("error", err.message || String(err));
    } finally {
      setLoadingAction(null);
    }
  };

  return (
    <div className="flex-1 w-full max-w-7xl mx-auto px-4 py-8 sm:px-6 lg:px-8">
      
      {/* 1. Header Section */}
      <header className="glass-panel rounded-2xl p-6 mb-8 flex flex-col md:flex-row items-center justify-between gap-6 relative overflow-hidden">
        {/* Subtle decorative glow */}
        <div className="absolute -top-10 -left-10 w-40 h-40 bg-violet-600/10 rounded-full blur-2xl pointer-events-none"></div>
        
        <div className="flex items-center gap-4 relative">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-tr from-violet-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-violet-500/20">
            {/* SVG Logo */}
            <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
              VaultLink
              <span className="text-[10px] uppercase bg-violet-950 text-violet-400 border border-violet-800 px-2 py-0.5 rounded font-mono font-medium tracking-widest pulse-glow-violet">
                Secure V2
              </span>
            </h1>
            <p className="text-xs text-zinc-400">Soroban Multi-Signature Treasury Control</p>
          </div>
        </div>

        {/* Global Settings / Connections */}
        <div className="flex flex-wrap items-center justify-center gap-4">
          
          {/* Toggle Network Mode */}
          <div className="bg-zinc-950 p-1 rounded-xl border border-zinc-800 flex">
            <button
              onClick={() => setNetworkMode("simulation")}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                networkMode === "simulation"
                  ? "bg-violet-600 text-white shadow-md shadow-violet-500/20"
                  : "text-zinc-400 hover:text-white"
              }`}
            >
              Simulation Sandbox
            </button>
            <button
              onClick={() => setNetworkMode("testnet")}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                networkMode === "testnet"
                  ? "bg-violet-600 text-white shadow-md shadow-violet-500/20"
                  : "text-zinc-400 hover:text-white"
              }`}
            >
              Stellar Testnet
            </button>
          </div>

          {/* Identity Switcher (Simulation Only) */}
          {networkMode === "simulation" ? (
            <div className="flex items-center gap-2 bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-1">
              <label htmlFor="sim-member" className="text-[10px] uppercase font-mono text-zinc-400 font-bold">Simulate As:</label>
              <select
                id="sim-member"
                value={activeSimUser}
                onChange={handleUserChange}
                className="bg-transparent text-xs text-violet-400 font-bold outline-none border-none cursor-pointer py-1"
              >
                <option value={SIM_ACCOUNTS.ALICE} className="bg-zinc-900 text-zinc-100">Alice (Member)</option>
                <option value={SIM_ACCOUNTS.BOB} className="bg-zinc-900 text-zinc-100">Bob (Member)</option>
                <option value={SIM_ACCOUNTS.CHARLIE} className="bg-zinc-900 text-zinc-100">Charlie (Member)</option>
                <option value={SIM_ACCOUNTS.ADMIN} className="bg-zinc-900 text-zinc-100">Admin (Owner)</option>
              </select>
            </div>
          ) : (
            /* Wallet Connection (Testnet Only) */
            <div className="flex items-center gap-2">
              {wallet.isConnected ? (
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <p className="text-xs text-zinc-200 font-mono font-medium">
                      {wallet.address?.substring(0, 6)}...{wallet.address?.substring(wallet.address.length - 4)}
                    </p>
                    <p className="text-[10px] text-zinc-400">{wallet.balance} XLM</p>
                  </div>
                  <button
                    onClick={handleDisconnectWallet}
                    className="px-3 py-1.5 border border-zinc-800 hover:border-red-900/50 hover:bg-red-950/20 hover:text-red-400 text-xs rounded-xl font-medium transition-colors"
                  >
                    Disconnect
                  </button>
                </div>
              ) : (
                <button
                  onClick={handleConnectWallet}
                  disabled={loadingAction === "connect_wallet"}
                  className="px-4 py-2 bg-gradient-to-tr from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-xs rounded-xl font-semibold shadow-lg shadow-violet-500/10 flex items-center gap-2"
                >
                  {loadingAction === "connect_wallet" ? (
                    <>
                      <svg className="animate-spin h-3 w-3 text-white" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Connecting...
                    </>
                  ) : (
                    <>
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
                      </svg>
                      Connect Freighter
                    </>
                  )}
                </button>
              )}
            </div>
          )}
        </div>
      </header>

      {/* Global Alerts Banner */}
      {notification && (
        <div className={`p-4 rounded-xl mb-8 flex items-center gap-3 border shadow-md animate-fade-in ${
          notification.type === "success" 
            ? "bg-emerald-950/40 border-emerald-800/50 text-emerald-300"
            : notification.type === "error"
            ? "bg-rose-950/40 border-rose-800/50 text-rose-300"
            : "bg-indigo-950/40 border-indigo-800/50 text-indigo-300"
        }`}>
          <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            {notification.type === "success" ? (
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            ) : notification.type === "error" ? (
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            )}
          </svg>
          <span className="text-xs font-medium">{notification.message}</span>
        </div>
      )}

      {/* 2. Simulation Tips Banner */}
      {networkMode === "simulation" && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 mb-8 flex items-start gap-3.5">
          <div className="p-2 bg-violet-950 rounded-lg text-violet-400">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
          </div>
          <div>
            <h4 className="text-xs font-semibold text-zinc-200 uppercase tracking-wider font-mono">Sandbox Playground Guides</h4>
            <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
              You are simulating transactions in a local sandbox. Switch identity using **Simulate As** dropdown in the header to approve a request from different signer accounts. 
              The threshold is set to **{config.threshold} approvals**. You need to approve a request from at least {config.threshold} different members before you can click **Execute**.
            </p>
            <div className="flex gap-4 mt-3">
              <button
                onClick={handleResetSimulation}
                className="text-[10px] font-bold text-violet-400 hover:text-violet-300 uppercase font-mono flex items-center gap-1"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 1121.21 15H19" />
                </svg>
                Reset Sandbox State
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 3. Stat Dashboard Grid */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {/* Stat 1: Vault Balance */}
        <div className="glass-panel rounded-2xl p-5 relative overflow-hidden flex flex-col justify-between">
          <div className="absolute top-4 right-4 text-violet-500">
            <svg className="w-8 h-8 opacity-25" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <span className="text-[10px] font-bold uppercase text-zinc-400 tracking-widest font-mono">Vault Reserves</span>
          <h2 className="text-3xl font-extrabold text-white mt-2 tracking-tight">
            {parseFloat(vaultBalance).toLocaleString()} <span className="text-xs font-semibold text-violet-400">USDC</span>
          </h2>
          {networkMode === "simulation" ? (
            <p className="text-[10px] text-zinc-400 mt-2">
              Your mock wallet: <span className="text-violet-400 font-bold font-mono">{parseFloat(getSimulatedUserBalance()).toLocaleString()} USDC</span>
            </p>
          ) : (
            <p className="text-[10px] text-zinc-400 mt-2">Connected network: Testnet</p>
          )}
        </div>

        {/* Stat 2: Threshold approvals */}
        <div className="glass-panel rounded-2xl p-5 relative overflow-hidden flex flex-col justify-between">
          <div className="absolute top-4 right-4 text-violet-500">
            <svg className="w-8 h-8 opacity-25" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
          </div>
          <span className="text-[10px] font-bold uppercase text-zinc-400 tracking-widest font-mono">Signing Policy</span>
          <h2 className="text-3xl font-extrabold text-white mt-2 tracking-tight">
            {config.threshold} <span className="text-sm font-semibold text-zinc-400">of {networkMode === "simulation" ? "3 Signers" : "2 Signers"}</span>
          </h2>
          <div className="text-[9px] text-zinc-400 mt-2 flex gap-1 items-center">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block"></span>
            Multi-sig enforcement Active
          </div>
        </div>

        {/* Stat 3: Total Requests summary */}
        <div className="glass-panel rounded-2xl p-5 relative overflow-hidden flex flex-col justify-between">
          <div className="absolute top-4 right-4 text-violet-500">
            <svg className="w-8 h-8 opacity-25" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
            </svg>
          </div>
          <span className="text-[10px] font-bold uppercase text-zinc-400 tracking-widest font-mono">Total Transfers</span>
          <h2 className="text-3xl font-extrabold text-white mt-2 tracking-tight">
            {requests.length} <span className="text-xs font-semibold text-zinc-400">Proposals</span>
          </h2>
          <p className="text-[10px] text-zinc-400 mt-2">
            Pending: <span className="text-yellow-400 font-bold">{requests.filter(r => r.status === 0).length}</span> | Executed: <span className="text-emerald-400 font-bold">{requests.filter(r => r.status === 1).length}</span>
          </p>
        </div>

        {/* Stat 4: Contracts info */}
        <div className="glass-panel rounded-2xl p-5 relative overflow-hidden flex flex-col justify-between">
          <span className="text-[10px] font-bold uppercase text-zinc-400 tracking-widest font-mono">Contract Target</span>
          <div className="mt-2.5">
            <div className="flex items-center justify-between text-[11px] font-mono border-b border-zinc-900 pb-1.5">
              <span className="text-zinc-400 font-semibold">Vault Core:</span>
              <span className="text-violet-400" title={CONTRACTS.vaultId}>
                {CONTRACTS.vaultId.substring(0, 8)}...
              </span>
            </div>
            <div className="flex items-center justify-between text-[11px] font-mono pt-1.5">
              <span className="text-zinc-400 font-semibold">Registry:</span>
              <span className="text-violet-400" title={CONTRACTS.registryId}>
                {CONTRACTS.registryId.substring(0, 8)}...
              </span>
            </div>
          </div>
          <div className="text-[9px] text-zinc-500 mt-2 text-right">
            Deployed on Soroban
          </div>
        </div>
      </section>

      {/* 4. Main content division */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Left Hand: Forms (Deposit & Create Request) */}
        <div className="lg:col-span-1 flex flex-col gap-8">
          
          {/* Form: Deposit */}
          <div className="glass-panel rounded-2xl p-6 relative overflow-hidden">
            <h3 className="text-base font-bold text-white mb-4 flex items-center gap-2">
              <svg className="w-5 h-5 text-violet-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Deposit Funds
            </h3>
            
            <form onSubmit={handleDeposit} className="flex flex-col gap-4">
              <div>
                <label htmlFor="deposit-input" className="block text-[10px] uppercase font-bold tracking-wider text-zinc-400 mb-1.5 font-mono">Amount (USDC)</label>
                <div className="relative">
                  <input
                    id="deposit-input"
                    type="number"
                    value={depositAmount}
                    onChange={(e) => setDepositAmount(e.target.value)}
                    placeholder="e.g. 500"
                    disabled={loadingAction === "deposit"}
                    className="w-full bg-zinc-950 border border-zinc-800 text-white rounded-xl py-3 px-4 text-sm font-semibold outline-none focus:border-violet-500 transition-colors"
                  />
                  <div className="absolute right-4 top-3 text-xs font-bold text-zinc-500 font-mono">
                    USDC
                  </div>
                </div>
              </div>
              
              <button
                type="submit"
                disabled={loadingAction === "deposit" || !depositAmount}
                className="w-full h-11 bg-gradient-to-tr from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 disabled:from-zinc-900 disabled:to-zinc-900 disabled:text-zinc-600 text-xs font-semibold text-white rounded-xl transition-all shadow-md shadow-violet-500/5 flex items-center justify-center gap-2 cursor-pointer"
              >
                {loadingAction === "deposit" ? (
                  <>
                    <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Executing Deposit...
                  </>
                ) : (
                  <>Deposit to Vault</>
                )}
              </button>
            </form>
            {networkMode === "testnet" && wallet.isConnected && (
              <div className="mt-4 pt-4 border-t border-zinc-900/60 flex flex-col gap-2">
                <p className="text-[10px] text-zinc-500 font-semibold font-mono uppercase tracking-wider">Testnet Utilities:</p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleEstablishTrustline}
                    disabled={loadingAction !== null}
                    className="flex-1 py-2 border border-violet-850 hover:border-violet-750 bg-violet-950/20 hover:bg-violet-950/50 disabled:border-zinc-900 disabled:bg-transparent disabled:text-zinc-600 text-[10px] font-bold text-violet-300 rounded-lg transition-all cursor-pointer flex items-center justify-center gap-1.5"
                  >
                    {loadingAction === "establish_trustline" ? (
                      <>
                        <svg className="animate-spin h-3 w-3 text-violet-400" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        Adding...
                      </>
                    ) : (
                      <>Add USDC Trustline</>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={handleRequestFaucet}
                    disabled={loadingAction !== null}
                    className="flex-1 py-2 border border-zinc-800 hover:border-zinc-700 bg-zinc-900/30 hover:bg-zinc-900/70 disabled:border-zinc-900 disabled:bg-transparent disabled:text-zinc-650 text-[10px] font-bold text-zinc-300 rounded-lg transition-all cursor-pointer flex items-center justify-center gap-1.5"
                  >
                    {loadingAction === "request_faucet" ? (
                      <>
                        <svg className="animate-spin h-3 w-3 text-zinc-400" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        Minting...
                      </>
                    ) : (
                      <>Get 5,000 USDC</>
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Form: Submit Request */}
          <div className="glass-panel rounded-2xl p-6 relative overflow-hidden">
            <h3 className="text-base font-bold text-white mb-4 flex items-center gap-2">
              <svg className="w-5 h-5 text-violet-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              Create Spending Proposal
            </h3>
            
            <form onSubmit={handleSubmitRequest} className="flex flex-col gap-4">
              
              <div>
                <label htmlFor="recipient-input" className="block text-[10px] uppercase font-bold tracking-wider text-zinc-400 mb-1.5 font-mono">Recipient Address</label>
                <input
                  id="recipient-input"
                  type="text"
                  value={newRequest.recipient}
                  onChange={(e) => setNewRequest({ ...newRequest, recipient: e.target.value })}
                  placeholder="G..."
                  disabled={loadingAction === "submit_request"}
                  className="w-full bg-zinc-950 border border-zinc-800 text-white rounded-xl py-3 px-4 text-xs font-mono outline-none focus:border-violet-500 transition-colors"
                />
                {networkMode === "simulation" && (
                  <button
                    type="button"
                    onClick={() => setNewRequest({ ...newRequest, recipient: SIM_ACCOUNTS.RECIPIENT })}
                    className="text-[9px] text-violet-400 hover:text-violet-300 font-mono mt-1 underline"
                  >
                    Insert Mock Recipient Address
                  </button>
                )}
              </div>

              <div>
                <label htmlFor="amount-input" className="block text-[10px] uppercase font-bold tracking-wider text-zinc-400 mb-1.5 font-mono">Amount (USDC)</label>
                <input
                  id="amount-input"
                  type="number"
                  value={newRequest.amount}
                  onChange={(e) => setNewRequest({ ...newRequest, amount: e.target.value })}
                  placeholder="e.g. 1000"
                  disabled={loadingAction === "submit_request"}
                  className="w-full bg-zinc-950 border border-zinc-800 text-white rounded-xl py-3 px-4 text-sm font-semibold outline-none focus:border-violet-500 transition-colors"
                />
              </div>

              <div>
                <label htmlFor="desc-input" className="block text-[10px] uppercase font-bold tracking-wider text-zinc-400 mb-1.5 font-mono">Proposal Description</label>
                <textarea
                  id="desc-input"
                  value={newRequest.description}
                  onChange={(e) => setNewRequest({ ...newRequest, description: e.target.value })}
                  placeholder="Explain what these treasury funds will be used for..."
                  rows={3}
                  disabled={loadingAction === "submit_request"}
                  className="w-full bg-zinc-950 border border-zinc-800 text-white rounded-xl py-3 px-4 text-xs outline-none focus:border-violet-500 transition-colors resize-none"
                />
              </div>

              <button
                type="submit"
                disabled={loadingAction === "submit_request" || !newRequest.recipient || !newRequest.amount || !newRequest.description}
                className="w-full h-11 bg-gradient-to-tr from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 disabled:from-zinc-900 disabled:to-zinc-900 disabled:text-zinc-600 text-xs font-semibold text-white rounded-xl transition-all shadow-md shadow-violet-500/5 flex items-center justify-center gap-2 cursor-pointer"
              >
                {loadingAction === "submit_request" ? (
                  <>
                    <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Creating Proposal...
                  </>
                ) : (
                  <>Submit Spending Request</>
                )}
              </button>
            </form>
          </div>

        </div>

        {/* Right Hand: Spending Requests List (Spans 2 columns) */}
        <div className="lg:col-span-2 flex flex-col gap-6">
          <div className="glass-panel rounded-2xl p-6 flex-1 flex flex-col">
            <div className="flex items-center justify-between border-b border-zinc-900 pb-4 mb-6">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <svg className="w-5 h-5 text-violet-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                  </svg>
                  Spending Requests Registry
                </h3>
                <p className="text-xs text-zinc-400 mt-0.5">Threshold-governed payments status</p>
              </div>
              <span className="text-xs font-bold font-mono px-3 py-1 bg-zinc-950 border border-zinc-800 rounded-full text-zinc-400">
                {requests.length} Total
              </span>
            </div>

            {requests.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-12">
                <svg className="w-12 h-12 text-zinc-700 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0a2 2 0 01-2 2H6a2 2 0 01-2-2m16 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
                <h4 className="text-sm font-semibold text-zinc-300">No requests found</h4>
                <p className="text-xs text-zinc-500 mt-1 max-w-sm">Use the form on the left to submit a new spending proposal to the contract signers.</p>
              </div>
            ) : (
              <div className="flex flex-col gap-4 max-h-[750px] overflow-y-auto pr-1">
                {requests.map((req) => {
                  const hasApprovedLocal = typeof window !== "undefined" && localStorage.getItem(`approved_${req.id}_${activeSimUser}`);
                  const meetsThreshold = req.approvalsCount >= config.threshold;
                  
                  return (
                    <div
                      key={req.id}
                      className="p-5 rounded-2xl bg-zinc-950/40 border border-zinc-900 flex flex-col md:flex-row md:items-center justify-between gap-6 transition-all hover:bg-zinc-950/70 hover:border-zinc-800"
                    >
                      {/* Left Block: Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-extrabold font-mono text-violet-400">#{req.id}</span>
                          <span className="text-xs font-semibold text-zinc-300">{req.description}</span>
                          
                          {/* Badge based on Status */}
                          {req.status === 0 ? (
                            <span className="text-[9px] uppercase px-2 py-0.5 rounded font-bold font-mono tracking-wider bg-amber-950 text-amber-400 border border-amber-800 flex items-center gap-1.5">
                              <span className="w-1 h-1 rounded-full bg-amber-400 animate-ping"></span>
                              Pending
                            </span>
                          ) : req.status === 1 ? (
                            <span className="text-[9px] uppercase px-2 py-0.5 rounded font-bold font-mono tracking-wider bg-emerald-950 text-emerald-400 border border-emerald-800">
                              Executed
                            </span>
                          ) : (
                            <span className="text-[9px] uppercase px-2 py-0.5 rounded font-bold font-mono tracking-wider bg-zinc-900 text-zinc-400 border border-zinc-800">
                              Cancelled
                            </span>
                          )}
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 mt-3 text-xs text-zinc-500">
                          <div>
                            <span className="font-semibold text-zinc-400">Recipient:</span>{" "}
                            <span className="font-mono text-zinc-300" title={req.recipient}>
                              {getAccountLabel(req.recipient)}
                            </span>
                          </div>
                          <div>
                            <span className="font-semibold text-zinc-400">Proposer:</span>{" "}
                            <span className="font-mono text-zinc-300">
                              {getAccountLabel(req.proposer)}
                            </span>
                          </div>
                          <div className="sm:col-span-2 text-[10px] text-zinc-500 font-mono mt-1">
                            Proposed: {new Date(req.createdAt).toLocaleString()}
                          </div>
                        </div>

                        {/* Progress Bar (Visible if pending) */}
                        {req.status === 0 && (
                          <div className="mt-4">
                            <div className="flex justify-between items-center text-[10px] text-zinc-400 font-semibold mb-1">
                              <span>Signatures / Approvals</span>
                              <span className={meetsThreshold ? "text-emerald-400 font-bold" : "text-violet-400 font-bold"}>
                                {req.approvalsCount} of {config.threshold} Met
                              </span>
                            </div>
                            <div className="h-1.5 w-full bg-zinc-900 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all duration-500 ${
                                  meetsThreshold ? "bg-emerald-500" : "bg-violet-500"
                                }`}
                                style={{ width: `${Math.min(100, (req.approvalsCount / config.threshold) * 100)}%` }}
                              ></div>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Right Block: Amount & Actions */}
                      <div className="flex flex-col items-start md:items-end justify-between self-stretch flex-shrink-0 gap-3">
                        <div className="text-xl font-black text-white font-mono">
                          {parseFloat(req.amount).toLocaleString()}{" "}
                          <span className="text-xs font-bold text-violet-400">USDC</span>
                        </div>

                        {/* Action buttons */}
                        {req.status === 0 && (
                          <div className="flex gap-2">
                            {/* Approve */}
                            <button
                              onClick={() => handleApproveRequest(req.id)}
                              disabled={loadingAction === `approve_${req.id}` || (networkMode === "simulation" && !!hasApprovedLocal)}
                              className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all ${
                                networkMode === "simulation" && hasApprovedLocal
                                  ? "bg-zinc-950 border-zinc-900 text-zinc-600 cursor-not-allowed"
                                  : "bg-violet-950 border-violet-800 text-violet-300 hover:bg-violet-900 hover:text-white"
                              }`}
                            >
                              {loadingAction === `approve_${req.id}` ? "..." : hasApprovedLocal ? "Approved" : "Approve"}
                            </button>

                            {/* Execute */}
                            <button
                              onClick={() => handleExecuteRequest(req.id)}
                              disabled={!meetsThreshold || loadingAction === `execute_${req.id}`}
                              className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all ${
                                meetsThreshold
                                  ? "bg-emerald-950 border-emerald-800 text-emerald-300 hover:bg-emerald-900 hover:text-white cursor-pointer"
                                  : "bg-zinc-950 border-zinc-900 text-zinc-600 cursor-not-allowed"
                              }`}
                            >
                              {loadingAction === `execute_${req.id}` ? "Executing..." : "Execute"}
                            </button>

                            {/* Cancel */}
                            {(activeSimUser === req.proposer || activeSimUser === config.admin || networkMode === "testnet") && (
                              <button
                                onClick={() => handleCancelRequest(req.id)}
                                disabled={loadingAction === `cancel_${req.id}`}
                                className="px-2 py-1.5 text-xs font-semibold rounded-lg border border-zinc-900 hover:border-red-900/40 hover:bg-red-950/20 text-zinc-500 hover:text-red-400 transition-all cursor-pointer"
                              >
                                {loadingAction === `cancel_${req.id}` ? "..." : "Cancel"}
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

      </div>

      {/* 5. Registry Vault Catalog & Event Log Ledger (Bottom) */}
      <footer className="glass-panel rounded-2xl p-6 mt-8 grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Left Bottom: Registry Catalog */}
        <div className="lg:col-span-1 border-r border-zinc-900 lg:pr-8">
          <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-400 font-mono mb-4 flex items-center gap-2">
            <svg className="w-4 h-4 text-violet-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
            Registry Vault Catalog
          </h4>
          
          <div className="flex flex-col gap-3">
            <div className="p-3 bg-zinc-950/60 border border-zinc-900 rounded-xl flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-zinc-200">VaultLink Alpha (Primary)</p>
                <p className="text-[10px] text-zinc-500 font-mono">{CONTRACTS.vaultId.substring(0, 16)}...</p>
              </div>
              <span className="text-[9px] uppercase px-1.5 py-0.5 rounded font-bold font-mono bg-emerald-950/40 text-emerald-400 border border-emerald-900/60">
                Registered
              </span>
            </div>
            
            <div className="p-3 bg-zinc-950/20 border border-dashed border-zinc-900 rounded-xl flex items-center justify-between opacity-50">
              <div>
                <p className="text-xs font-semibold text-zinc-400">VaultLink Beta (Standby)</p>
                <p className="text-[10px] text-zinc-600 font-mono">Not deployed...</p>
              </div>
              <span className="text-[9px] uppercase px-1.5 py-0.5 rounded font-bold font-mono bg-zinc-900 text-zinc-600 border border-zinc-800">
                Offline
              </span>
            </div>
          </div>
        </div>

        {/* Right Bottom: Activity Ledger */}
        <div className="lg:col-span-2">
          <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-400 font-mono mb-4 flex items-center justify-between">
            <span className="flex items-center gap-2">
              <svg className="w-4 h-4 text-violet-500 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Soroban Registry Event Ledger
            </span>
            <span className="text-[9px] uppercase bg-violet-950 px-2 py-0.5 rounded text-violet-400 font-mono border border-violet-850">
              Live Feed
            </span>
          </h4>

          <div className="flex flex-col gap-2.5 max-h-[160px] overflow-y-auto pr-1">
            {activities.map((act) => (
              <div key={act.id} className="text-xs flex items-start gap-3 py-1.5 border-b border-zinc-900/60 last:border-0">
                <span className="text-zinc-600 font-mono text-[10px] flex-shrink-0 pt-0.5">
                  {new Date(act.timestamp).toLocaleTimeString()}
                </span>
                
                {/* Event Type Icon Indicator */}
                <div className="flex-shrink-0 mt-0.5">
                  {act.type === "deposit" ? (
                    <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" title="Deposit"></span>
                  ) : act.type === "submit_request" ? (
                    <span className="w-2 h-2 rounded-full bg-violet-500 inline-block" title="Proposal"></span>
                  ) : act.type === "approve_request" ? (
                    <span className="w-2 h-2 rounded-full bg-indigo-500 inline-block" title="Approval"></span>
                  ) : act.type === "execute_request" ? (
                    <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" title="Execution"></span>
                  ) : act.type === "cancel_request" ? (
                    <span className="w-2 h-2 rounded-full bg-zinc-500 inline-block" title="Cancellation"></span>
                  ) : (
                    <span className="w-2 h-2 rounded-full bg-violet-400 inline-block" title="Register"></span>
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <span className="text-zinc-300 font-medium">{act.details}</span>{" "}
                  <span className="text-zinc-500 text-[10px] font-mono">
                    by {getAccountLabel(act.user)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

      </footer>

    </div>
  );
}
