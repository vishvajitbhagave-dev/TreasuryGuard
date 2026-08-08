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
  fetchContractConfig,
  fetchXlmBalance,
  sendXlmTransaction,
  fetchContractEvents
} from "./stellar";

const isValidStellarAddress = (addr: string) => {
  return /^[G][A-D][A-Z2-7]{54}$/.test(addr);
};

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
  
  // XLM Payment Form State (Stellar Journey Requirement)
  const [recipientXlm, setRecipientXlm] = useState<string>("");
  const [amountXlm, setAmountXlm] = useState<string>("");
  
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
          const xlmBal = await fetchXlmBalance(wallet.address);
          setWallet(w => ({ ...w, balance: tokenBal, xlmBalance: xlmBal }));
        }
        
        try {
          const liveEvents = await fetchContractEvents(CONTRACTS.vaultId);
          if (liveEvents && liveEvents.length > 0) {
            setActivities(liveEvents);
          } else {
            setActivities([
              {
                id: "t1",
                timestamp: Date.now() - 3600000 * 6,
                type: "vault_registered",
                user: CONTRACTS.vaultId,
                details: "Deployed and registered contract on Stellar Testnet"
              }
            ]);
          }
        } catch (eventErr) {
          console.error("Failed to sync live events:", eventErr);
        }
      } catch (err) {
        console.error("Error syncing testnet state:", err);
      }
    }
  };

  useEffect(() => {
    syncState();
  }, [networkMode, wallet.address]);

  // Poll live testnet data every 10 seconds for real-time event integration (Level 2)
  useEffect(() => {
    if (networkMode === "simulation") return;
    const interval = setInterval(() => {
      syncState();
    }, 10000);
    return () => clearInterval(interval);
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
      let liveXlmBalance = "0";
      try {
        liveBalance = await fetchTokenBalance(CONTRACTS.tokenId, pubKey);
        liveXlmBalance = await fetchXlmBalance(pubKey);
      } catch (e) {
        console.error("Failed to fetch balances on connection:", e);
      }
      setWallet({
        address: pubKey,
        balance: liveBalance,
        xlmBalance: liveXlmBalance,
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

  // Send native XLM transaction flow (Stellar Journey Requirement)
  const handleSendXlm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!amountXlm || !recipientXlm) return;

    // Validation 1: Invalid Public Key Format
    if (!isValidStellarAddress(recipientXlm)) {
      triggerNotification("error", "Invalid Address Format: Recipient address must be a valid 56-character Stellar public key starting with G.");
      return;
    }

    // Validation 2: Invalid Amount
    const xlmVal = parseFloat(amountXlm);
    if (isNaN(xlmVal) || xlmVal <= 0) {
      triggerNotification("error", "Invalid Amount: XLM payment amount must be greater than zero.");
      return;
    }

    // Validation 3: Insufficient Balance
    if (networkMode === "testnet") {
      const userBal = parseFloat(wallet.xlmBalance || "0");
      if (userBal < xlmVal) {
        triggerNotification("error", `Insufficient Balance: Your wallet has ${userBal} XLM, which is less than the requested transfer amount of ${xlmVal} XLM.`);
        return;
      }
    }

    setLoadingAction("send_xlm");
    try {
      if (networkMode === "simulation") {
        triggerNotification("success", `Simulation: Successfully sent ${amountXlm} XLM to recipient! (Mock Tx: tx_xlm_sim_${Math.random().toString(36).substring(2, 10)})`);
        setRecipientXlm("");
        setAmountXlm("");
      } else {
        if (!wallet.address) {
          triggerNotification("error", "Please connect Freighter wallet first.");
          setLoadingAction(null);
          return;
        }
        const txHash = await sendXlmTransaction(wallet.address, recipientXlm, amountXlm);
        triggerNotification("success", `Payment Sent! Hash: ${txHash.substring(0, 16)}...`);
        setRecipientXlm("");
        setAmountXlm("");
        syncState();
      }
    } catch (err: any) {
      triggerNotification("error", err.message || String(err));
    } finally {
      setLoadingAction(null);
    }
  };

  // Deposit Actions
  const handleDeposit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!depositAmount) return;

    // Validation 1: Invalid Amount
    const depositVal = parseFloat(depositAmount);
    if (isNaN(depositVal) || depositVal <= 0) {
      triggerNotification("error", "Invalid Amount: Deposit amount must be greater than zero.");
      return;
    }

    // Validation 2: Insufficient Balance
    if (networkMode === "simulation") {
      const userBal = parseFloat(getSimulatedUserBalance());
      if (userBal < depositVal) {
        triggerNotification("error", `Insufficient Balance: Simulated wallet has ${userBal} USDC, which is less than the deposit of ${depositVal} USDC.`);
        return;
      }
    } else {
      if (!wallet.address) {
        triggerNotification("error", "Please connect Freighter wallet first.");
        return;
      }
      const userBal = parseFloat(wallet.balance || "0");
      if (userBal < depositVal) {
        triggerNotification("error", `Insufficient Balance: Your wallet has ${userBal} USDC, which is less than the requested deposit of ${depositVal} USDC.`);
        return;
      }
    }

    const amount = depositAmount;
    setLoadingAction("deposit");

    try {
      if (networkMode === "simulation") {
        simulatedDeposit(activeSimUser, depositVal);
        syncState();
        setDepositAmount("");
        triggerNotification("success", `Deposited ${amount} USDC into the vault!`);
      } else {
        const txHash = await depositToVault(CONTRACTS.vaultId, amount, wallet.address!);
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

    // Validation 1: Invalid Public Key Format
    if (!isValidStellarAddress(newRequest.recipient)) {
      triggerNotification("error", "Invalid Address Format: Recipient address must be a valid 56-character Stellar public key starting with G.");
      return;
    }

    // Validation 2: Invalid Amount
    const amountVal = parseFloat(newRequest.amount);
    if (isNaN(amountVal) || amountVal <= 0) {
      triggerNotification("error", "Invalid Amount: Proposal request amount must be greater than zero.");
      return;
    }

    // Validation 3: Insufficient Vault Balance
    const availableVaultBal = parseFloat(vaultBalance);
    if (isNaN(availableVaultBal)) {
      triggerNotification("error", "Error: Vault balance could not be verified. Please try again later.");
      return;
    }
    const amountScaled = Math.round(amountVal * 10000000);
    const vaultScaled = Math.round(availableVaultBal * 10000000);
    if (amountScaled > vaultScaled) {
      triggerNotification("error", `Insufficient vault balance. Available: ${availableVaultBal} USDC.`);
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
      <header className="glass-panel rounded-xl p-5 mb-8 flex flex-col md:flex-row items-center justify-between gap-6 relative">
        
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-lg bg-blue-950/40 border border-blue-900/30 flex items-center justify-center shadow-inner">
            {/* SVG Logo */}
            <svg className="w-5 h-5 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
              VaultLink
              <span className="text-[9px] uppercase bg-cyan-950/40 text-cyan-400 border border-cyan-800/40 px-1.5 py-0.5 rounded font-mono font-semibold tracking-widest pulse-glow-violet">
                Secure V2
              </span>
            </h1>
            <p className="text-xs text-slate-400 font-medium">Soroban Multi-Signature Treasury Control</p>
          </div>
        </div>

        {/* Global Settings / Connections */}
        <div className="flex flex-wrap items-center justify-center gap-4">
          
          {/* Toggle Network Mode */}
          <div className="bg-slate-950/60 p-1 rounded-lg border border-slate-800/60 flex">
            <button
              onClick={() => setNetworkMode("simulation")}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                networkMode === "simulation"
                  ? "bg-blue-600 text-white shadow-md shadow-blue-500/25 border border-blue-500/30"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              Simulation Sandbox
            </button>
            <button
              onClick={() => setNetworkMode("testnet")}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                networkMode === "testnet"
                  ? "bg-blue-600 text-white shadow-md shadow-blue-500/25 border border-blue-500/30"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              Stellar Testnet
            </button>
          </div>

          {/* Identity Switcher (Simulation Only) */}
          {networkMode === "simulation" ? (
            <div className="flex items-center gap-2 bg-slate-900/50 border border-slate-850 rounded-lg px-3 py-1.5">
              <label htmlFor="sim-member" className="text-[10px] uppercase font-mono text-slate-400 font-medium">Simulate As:</label>
              <select
                id="sim-member"
                value={activeSimUser}
                onChange={handleUserChange}
                className="bg-transparent text-xs text-cyan-400 font-bold outline-none border-none cursor-pointer py-0.5"
              >
                <option value={SIM_ACCOUNTS.ALICE} className="bg-slate-900 text-slate-100">Alice (Member)</option>
                <option value={SIM_ACCOUNTS.BOB} className="bg-slate-900 text-slate-100">Bob (Member)</option>
                <option value={SIM_ACCOUNTS.CHARLIE} className="bg-slate-900 text-slate-100">Charlie (Member)</option>
                <option value={SIM_ACCOUNTS.ADMIN} className="bg-slate-900 text-slate-100">Admin (Owner)</option>
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
                    <div className="flex gap-2 justify-end text-[9px] font-semibold font-mono">
                      <span className="text-cyan-400">{wallet.balance} USDC</span>
                      <span className="text-slate-650">|</span>
                      <span className="text-blue-400">{wallet.xlmBalance || "0"} XLM</span>
                    </div>
                  </div>
                  <button
                    onClick={handleDisconnectWallet}
                    className="px-3 py-1.5 border border-zinc-800 hover:border-red-900/50 hover:bg-red-950/20 hover:text-red-400 text-xs rounded-lg font-medium transition-colors"
                  >
                    Disconnect
                  </button>
                </div>
              ) : (
                <button
                  onClick={handleConnectWallet}
                  disabled={loadingAction === "connect_wallet"}
                  className="px-4 py-2 bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 text-white text-xs rounded-lg font-semibold transition-all shadow-md shadow-blue-500/10 flex items-center gap-2 cursor-pointer border border-blue-400/20"
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
        <div className="glass-panel rounded-xl p-5 relative overflow-hidden flex flex-col justify-between">
          <div className="absolute top-4 right-4 text-cyan-500/20">
            <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <span className="text-[10px] font-bold uppercase text-slate-400 tracking-widest font-mono">Vault Reserves</span>
          <h2 className="text-3xl font-extrabold text-white mt-2 tracking-tight">
            {parseFloat(vaultBalance).toLocaleString()} <span className="text-xs font-bold text-cyan-400 font-mono">USDC</span>
          </h2>
          {networkMode === "simulation" ? (
            <p className="text-[10px] text-slate-400 mt-2">
              Your mock wallet: <span className="text-cyan-400 font-bold font-mono">{parseFloat(getSimulatedUserBalance()).toLocaleString()} USDC</span>
            </p>
          ) : (
            <p className="text-[10px] text-slate-400 mt-2 font-medium">Connected network: <span className="text-blue-400 font-semibold font-mono">Testnet</span></p>
          )}
        </div>

        {/* Stat 2: Threshold approvals */}
        <div className="glass-panel rounded-xl p-5 relative overflow-hidden flex flex-col justify-between">
          <div className="absolute top-4 right-4 text-cyan-500/20">
            <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
          </div>
          <span className="text-[10px] font-bold uppercase text-slate-400 tracking-widest font-mono">Signing Policy</span>
          <h2 className="text-3xl font-extrabold text-white mt-2 tracking-tight">
            {config.threshold} <span className="text-sm font-semibold text-slate-400">of {networkMode === "simulation" ? "3 Signers" : "2 Signers"}</span>
          </h2>
          <div className="text-[9px] text-cyan-400/90 mt-2 flex gap-1.5 items-center font-semibold font-mono">
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 inline-block animate-pulse"></span>
            Multi-sig enforcement Active
          </div>
        </div>

        {/* Stat 3: Total Requests summary */}
        <div className="glass-panel rounded-xl p-5 relative overflow-hidden flex flex-col justify-between">
          <div className="absolute top-4 right-4 text-cyan-500/20">
            <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
            </svg>
          </div>
          <span className="text-[10px] font-bold uppercase text-slate-400 tracking-widest font-mono">Total Transfers</span>
          <h2 className="text-3xl font-extrabold text-white mt-2 tracking-tight">
            {requests.length} <span className="text-xs font-semibold text-slate-400">Proposals</span>
          </h2>
          <p className="text-[10px] text-slate-400 mt-2 font-medium">
            Pending: <span className="text-amber-400 font-bold">{requests.filter(r => r.status === 0).length}</span> | Executed: <span className="text-cyan-400 font-bold">{requests.filter(r => r.status === 1).length}</span>
          </p>
        </div>

        {/* Stat 4: Contracts info */}
        <div className="glass-panel rounded-xl p-5 relative overflow-hidden flex flex-col justify-between">
          <span className="text-[10px] font-bold uppercase text-slate-400 tracking-widest font-mono">Contract Target</span>
          <div className="mt-2.5">
            <div className="flex items-center justify-between text-[11px] font-mono border-b border-slate-900/60 pb-1.5">
              <span className="text-slate-400 font-medium">Vault Core:</span>
              <span className="text-cyan-400 font-semibold hover:text-cyan-300 transition-colors" title={CONTRACTS.vaultId}>
                {CONTRACTS.vaultId.substring(0, 8)}...
              </span>
            </div>
            <div className="flex items-center justify-between text-[11px] font-mono pt-1.5">
              <span className="text-slate-400 font-medium">Registry:</span>
              <span className="text-blue-400 font-semibold hover:text-blue-300 transition-colors" title={CONTRACTS.registryId}>
                {CONTRACTS.registryId.substring(0, 8)}...
              </span>
            </div>
          </div>
          <div className="text-[9px] text-slate-500 mt-2 text-right font-medium">
            Deployed on Soroban
          </div>
        </div>
      </section>

      {/* 4. Main content division */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Left Hand: Forms (Deposit & Create Request) */}
        <div className="lg:col-span-1 flex flex-col gap-8">
          
          {/* Form: Deposit */}
          <div className="glass-panel rounded-xl p-5 relative overflow-hidden">
            <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
              <svg className="w-4 h-4 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Deposit Funds
            </h3>
            
            <form onSubmit={handleDeposit} className="flex flex-col gap-4">
              <div>
                <label htmlFor="deposit-input" className="block text-[9px] uppercase font-medium tracking-wider text-slate-400 mb-1.5 font-mono">Amount (USDC)</label>
                <div className="relative">
                  <input
                    id="deposit-input"
                    type="number"
                    value={depositAmount}
                    onChange={(e) => setDepositAmount(e.target.value)}
                    placeholder="e.g. 500"
                    disabled={loadingAction === "deposit"}
                    className="w-full bg-slate-950/60 border border-slate-800/80 text-white rounded-lg py-2.5 px-3.5 text-sm font-medium outline-none focus:border-cyan-500/40 focus:ring-1 focus:ring-cyan-500/25 transition-all placeholder-slate-600"
                  />
                  <div className="absolute right-3.5 top-2.5 text-xs font-bold text-cyan-400 font-mono">
                    USDC
                  </div>
                </div>
              </div>
              
              <button
                type="submit"
                disabled={loadingAction === "deposit" || !depositAmount}
                className="w-full h-10 bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 disabled:from-slate-800 disabled:to-slate-800 disabled:text-slate-500 text-xs font-semibold text-white rounded-lg transition-all shadow-md shadow-blue-500/10 flex items-center justify-center gap-2 cursor-pointer border border-blue-400/10"
              >
                {loadingAction === "deposit" ? (
                  <>
                    <svg className="animate-spin h-3.5 w-3.5 text-white" fill="none" viewBox="0 0 24 24">
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
                    className="flex-1 py-2 border border-blue-900/40 hover:border-blue-700/60 bg-blue-950/20 hover:bg-blue-950/50 disabled:border-slate-900 disabled:bg-transparent disabled:text-slate-600 text-[10px] font-semibold text-cyan-400 rounded-lg transition-colors cursor-pointer flex items-center justify-center gap-1.5"
                  >
                    {loadingAction === "establish_trustline" ? (
                      <>
                        <svg className="animate-spin h-3 w-3 text-cyan-400" fill="none" viewBox="0 0 24 24">
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
                    className="flex-1 py-2 border border-slate-800 hover:border-slate-700 bg-slate-900/40 hover:bg-slate-900 disabled:border-slate-900 disabled:bg-transparent disabled:text-slate-650 text-[10px] font-semibold text-slate-300 rounded-lg transition-colors cursor-pointer flex items-center justify-center gap-1.5"
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

          {/* Form: Send XLM Payment (Stellar Journey Requirement) */}
          <div className="glass-panel rounded-xl p-5 relative overflow-hidden">
            <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
              <svg className="w-4 h-4 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
              Send XLM Payment
            </h3>
            
            <form onSubmit={handleSendXlm} className="flex flex-col gap-4">
              <div>
                <label htmlFor="xlm-recipient" className="block text-[9px] uppercase font-medium tracking-wider text-slate-400 mb-1.5 font-mono">Recipient XLM Address</label>
                <input
                  id="xlm-recipient"
                  type="text"
                  value={recipientXlm}
                  onChange={(e) => setRecipientXlm(e.target.value)}
                  placeholder="G..."
                  required
                  disabled={loadingAction === "send_xlm"}
                  className="w-full bg-slate-950/60 border border-slate-800/80 text-white rounded-lg py-2.5 px-3.5 text-xs font-mono outline-none focus:border-cyan-500/40 focus:ring-1 focus:ring-cyan-500/25 transition-all placeholder-slate-600"
                />
                {networkMode === "simulation" && (
                  <button
                    type="button"
                    onClick={() => setRecipientXlm(SIM_ACCOUNTS.RECIPIENT)}
                    className="text-[9px] text-cyan-400 hover:text-cyan-300 font-mono mt-1 underline cursor-pointer"
                  >
                    Insert Mock Recipient Address
                  </button>
                )}
              </div>

              <div>
                <label htmlFor="xlm-amount" className="block text-[9px] uppercase font-medium tracking-wider text-slate-400 mb-1.5 font-mono">Amount (XLM)</label>
                <input
                  id="xlm-amount"
                  type="number"
                  step="any"
                  value={amountXlm}
                  onChange={(e) => setAmountXlm(e.target.value)}
                  placeholder="e.g. 10"
                  required
                  disabled={loadingAction === "send_xlm"}
                  className="w-full bg-slate-950/60 border border-slate-800/80 text-white rounded-lg py-2.5 px-3.5 text-sm font-medium outline-none focus:border-cyan-500/40 focus:ring-1 focus:ring-cyan-500/25 transition-all placeholder-slate-600"
                />
              </div>

              <button
                type="submit"
                disabled={loadingAction === "send_xlm" || !recipientXlm || !amountXlm}
                className="w-full h-10 bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 disabled:from-slate-800 disabled:to-slate-800 disabled:text-slate-500 text-xs font-semibold text-white rounded-lg transition-all shadow-md shadow-blue-500/10 flex items-center justify-center gap-2 cursor-pointer border border-blue-400/10"
              >
                {loadingAction === "send_xlm" ? (
                  <>
                    <svg className="animate-spin h-3.5 w-3.5 text-white" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Executing Transfer...
                  </>
                ) : (
                  <>Send XLM Payment</>
                )}
              </button>
            </form>
          </div>

          {/* Form: Submit Request */}
          <div className="glass-panel rounded-xl p-5 relative overflow-hidden">
            <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
              <svg className="w-4 h-4 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              Create Spending Proposal
            </h3>
            
            <form onSubmit={handleSubmitRequest} className="flex flex-col gap-4">
              
              <div>
                <label htmlFor="recipient-input" className="block text-[9px] uppercase font-medium tracking-wider text-slate-400 mb-1.5 font-mono">Recipient Address</label>
                <input
                  id="recipient-input"
                  type="text"
                  value={newRequest.recipient}
                  onChange={(e) => setNewRequest({ ...newRequest, recipient: e.target.value })}
                  placeholder="G..."
                  disabled={loadingAction === "submit_request"}
                  className="w-full bg-slate-950/60 border border-slate-800/80 text-white rounded-lg py-2.5 px-3.5 text-xs font-mono outline-none focus:border-cyan-500/40 focus:ring-1 focus:ring-cyan-500/25 transition-all placeholder-slate-600"
                />
                {networkMode === "simulation" && (
                  <button
                    type="button"
                    onClick={() => setNewRequest({ ...newRequest, recipient: SIM_ACCOUNTS.RECIPIENT })}
                    className="text-[9px] text-cyan-400 hover:text-cyan-300 font-mono mt-1 underline cursor-pointer"
                  >
                    Insert Mock Recipient Address
                  </button>
                )}
              </div>

              <div>
                <label htmlFor="amount-input" className="block text-[9px] uppercase font-medium tracking-wider text-slate-400 mb-1.5 font-mono">Amount (USDC)</label>
                <input
                  id="amount-input"
                  type="number"
                  value={newRequest.amount}
                  onChange={(e) => setNewRequest({ ...newRequest, amount: e.target.value })}
                  placeholder="e.g. 1000"
                  disabled={loadingAction === "submit_request"}
                  className="w-full bg-slate-950/60 border border-slate-800/80 text-white rounded-lg py-2.5 px-3.5 text-sm font-medium outline-none focus:border-cyan-500/40 focus:ring-1 focus:ring-cyan-500/25 transition-all placeholder-slate-600"
                />
              </div>

              <div>
                <label htmlFor="desc-input" className="block text-[9px] uppercase font-medium tracking-wider text-slate-400 mb-1.5 font-mono">Proposal Description</label>
                <textarea
                  id="desc-input"
                  value={newRequest.description}
                  onChange={(e) => setNewRequest({ ...newRequest, description: e.target.value })}
                  placeholder="Explain what these treasury funds will be used for..."
                  rows={3}
                  disabled={loadingAction === "submit_request"}
                  className="w-full bg-slate-950/60 border border-slate-800/80 text-white rounded-lg py-2.5 px-3.5 text-xs outline-none focus:border-cyan-500/40 focus:ring-1 focus:ring-cyan-500/25 transition-all placeholder-slate-600"
                />
              </div>

              <button
                type="submit"
                disabled={loadingAction === "submit_request" || !newRequest.recipient || !newRequest.amount || !newRequest.description}
                className="w-full h-10 bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 disabled:from-slate-800 disabled:to-slate-800 disabled:text-slate-500 text-xs font-semibold text-white rounded-lg transition-all shadow-md shadow-blue-500/10 flex items-center justify-center gap-2 cursor-pointer border border-blue-400/10"
              >
                {loadingAction === "submit_request" ? (
                  <>
                    <svg className="animate-spin h-3.5 w-3.5 text-white" fill="none" viewBox="0 0 24 24">
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
          <div className="glass-panel rounded-xl p-5 flex-1 flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-900 pb-4 mb-6">
              <div>
                <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                  <svg className="w-4 h-4 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                  </svg>
                  Spending Requests Registry
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">Threshold-governed payments status</p>
              </div>
              <span className="text-xs font-semibold font-mono px-2.5 py-1 bg-slate-950 border border-slate-800 rounded-lg text-slate-350">
                {requests.length} Total
              </span>
            </div>

            {requests.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-12">
                <svg className="w-12 h-12 text-slate-700 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0a2 2 0 01-2 2H6a2 2 0 01-2-2m16 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
                <h4 className="text-sm font-semibold text-slate-300">No requests found</h4>
                <p className="text-xs text-slate-500 mt-1 max-w-sm">Use the form on the left to submit a new spending proposal to the contract signers.</p>
              </div>
            ) : (
              <div className="flex flex-col gap-4 max-h-[750px] overflow-y-auto pr-1">
                {requests.map((req) => {
                  const hasApprovedLocal = typeof window !== "undefined" && localStorage.getItem(`approved_${req.id}_${activeSimUser}`);
                  const meetsThreshold = req.approvalsCount >= config.threshold;
                  
                  return (
                    <div
                      key={req.id}
                      className="p-4 rounded-xl bg-slate-950/40 border border-slate-900 flex flex-col md:flex-row md:items-center justify-between gap-6 transition-all hover:bg-slate-950/70 hover:border-slate-800/80"
                    >
                      {/* Left Block: Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-bold font-mono text-cyan-400">#{req.id}</span>
                          <span className="text-xs font-medium text-slate-200">{req.description}</span>
                          
                          {/* Muted Badge based on Status */}
                          {req.status === 0 ? (
                            <span className="text-[9px] uppercase px-2 py-0.5 rounded font-bold font-mono tracking-wider bg-amber-950/40 text-amber-400 border border-amber-900/50 flex items-center gap-1.5">
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse"></span>
                              Pending
                            </span>
                          ) : req.status === 1 ? (
                            <span className="text-[9px] uppercase px-2 py-0.5 rounded font-bold font-mono tracking-wider bg-cyan-950/50 text-cyan-400 border border-cyan-800/50">
                              Executed
                            </span>
                          ) : (
                            <span className="text-[9px] uppercase px-2 py-0.5 rounded font-bold font-mono tracking-wider bg-slate-900/50 text-slate-450 border border-slate-800/50">
                              Cancelled
                            </span>
                          )}
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 mt-3 text-xs text-slate-400">
                          <div>
                            <span className="font-semibold text-slate-450">Recipient:</span>{" "}
                            <span className="font-mono text-slate-200 text-[11px]" title={req.recipient}>
                              {getAccountLabel(req.recipient)}
                            </span>
                          </div>
                          <div>
                            <span className="font-semibold text-slate-450">Proposer:</span>{" "}
                            <span className="font-mono text-slate-200 text-[11px]">
                              {getAccountLabel(req.proposer)}
                            </span>
                          </div>
                          <div className="sm:col-span-2 text-[10px] text-slate-500 font-mono mt-1">
                            Proposed: {new Date(req.createdAt).toLocaleString()}
                          </div>
                        </div>

                        {/* Progress Bar (Visible if pending) */}
                        {req.status === 0 && (
                          <div className="mt-4">
                            <div className="flex justify-between items-center text-[10px] text-slate-400 font-semibold mb-1">
                              <span>Signatures / Approvals</span>
                              <span className={meetsThreshold ? "text-cyan-455 font-bold" : "text-blue-400 font-bold"}>
                                {req.approvalsCount} of {config.threshold} Met
                              </span>
                            </div>
                            <div className="h-1.5 w-full bg-slate-950 border border-slate-900 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all duration-500 ${
                                  meetsThreshold ? "bg-cyan-500" : "bg-blue-600"
                                }`}
                                style={{ width: `${Math.min(100, (req.approvalsCount / config.threshold) * 100)}%` }}
                              ></div>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Right Block: Amount & Actions */}
                      <div className="flex flex-col items-start md:items-end justify-between self-stretch flex-shrink-0 gap-3">
                        <div className="text-lg font-bold text-white font-mono">
                          {parseFloat(req.amount).toLocaleString()}{" "}
                          <span className="text-xs font-bold text-cyan-400">USDC</span>
                        </div>

                        {/* Action buttons */}
                        {req.status === 0 && (
                          <div className="flex gap-2">
                            {/* Approve */}
                            <button
                              onClick={() => handleApproveRequest(req.id)}
                              disabled={loadingAction === `approve_${req.id}` || (networkMode === "simulation" && !!hasApprovedLocal)}
                              className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                                networkMode === "simulation" && hasApprovedLocal
                                  ? "bg-slate-950 border-slate-900 text-slate-650 cursor-not-allowed"
                                  : "bg-slate-900 border-slate-800 text-slate-200 hover:bg-slate-850 hover:border-blue-900/40 hover:text-white cursor-pointer"
                              }`}
                            >
                              {loadingAction === `approve_${req.id}` ? "..." : hasApprovedLocal ? "Approved" : "Approve"}
                            </button>

                            {/* Execute */}
                            <button
                              onClick={() => handleExecuteRequest(req.id)}
                              disabled={!meetsThreshold || loadingAction === `execute_${req.id}`}
                              className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors ${
                                meetsThreshold
                                  ? "bg-cyan-500 hover:bg-cyan-400 text-slate-950 border border-cyan-400/20 shadow-md shadow-cyan-500/10 cursor-pointer"
                                  : "bg-slate-950 border-slate-900 text-slate-650 cursor-not-allowed"
                              }`}
                            >
                              {loadingAction === `execute_${req.id}` ? "Executing..." : "Execute"}
                            </button>

                            {/* Cancel */}
                            {(activeSimUser === req.proposer || activeSimUser === config.admin || networkMode === "testnet") && (
                              <button
                                onClick={() => handleCancelRequest(req.id)}
                                disabled={loadingAction === `cancel_${req.id}`}
                                className="px-2 py-1.5 text-xs font-medium rounded-lg border border-slate-850 hover:border-red-900/40 hover:bg-red-950/15 text-slate-500 hover:text-red-400 transition-colors cursor-pointer"
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
      <footer className="glass-panel rounded-xl p-5 mt-8 grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Left Bottom: Registry Catalog */}
        <div className="lg:col-span-1 border-r border-slate-800/50 lg:pr-8">
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 font-mono mb-4 flex items-center gap-2">
            <svg className="w-4 h-4 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
            Registry Vault Catalog
          </h4>
          
          <div className="flex flex-col gap-3">
            <div className="p-3 bg-slate-950/40 border border-slate-900 rounded-lg flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-slate-200">VaultLink Alpha (Primary)</p>
                <p className="text-[10px] text-slate-550 font-mono">{CONTRACTS.vaultId.substring(0, 16)}...</p>
              </div>
              <span className="text-[9px] uppercase px-1.5 py-0.5 rounded font-bold font-mono bg-cyan-950/50 text-cyan-400 border border-cyan-800/40">
                Registered
              </span>
            </div>
            
            <div className="p-3 bg-slate-950/10 border border-dashed border-slate-900 rounded-lg flex items-center justify-between opacity-50">
              <div>
                <p className="text-xs font-semibold text-slate-450">VaultLink Beta (Standby)</p>
                <p className="text-[10px] text-slate-600 font-mono">Not deployed...</p>
              </div>
              <span className="text-[9px] uppercase px-1.5 py-0.5 rounded font-bold font-mono bg-slate-900/60 text-slate-500 border border-slate-850/60">
                Offline
              </span>
            </div>
          </div>
        </div>

        {/* Right Bottom: Activity Ledger */}
        <div className="lg:col-span-2">
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 font-mono mb-4 flex items-center justify-between">
            <span className="flex items-center gap-2">
              <svg className="w-4 h-4 text-cyan-400 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Soroban Registry Event Ledger
            </span>
            <span className="text-[9px] uppercase bg-cyan-950/40 px-2 py-0.5 rounded text-cyan-400 border border-cyan-800/35 font-mono">
              Live Feed
            </span>
          </h4>

          <div className="flex flex-col gap-2.5 max-h-[160px] overflow-y-auto pr-1">
            {activities.map((act) => (
              <div key={act.id} className="text-xs flex items-start gap-3 py-1.5 border-b border-slate-900/50 last:border-0">
                <span className="text-slate-500 font-mono text-[10px] flex-shrink-0 pt-0.5">
                  {new Date(act.timestamp).toLocaleTimeString()}
                </span>
                
                {/* Event Type Icon Indicator */}
                <div className="flex-shrink-0 mt-0.5">
                  {act.type === "deposit" ? (
                    <span className="w-2 h-2 rounded-full bg-cyan-400 inline-block" title="Deposit"></span>
                  ) : act.type === "submit_request" ? (
                    <span className="w-2 h-2 rounded-full bg-blue-500 inline-block" title="Proposal"></span>
                  ) : act.type === "approve_request" ? (
                    <span className="w-2 h-2 rounded-full bg-blue-400 inline-block" title="Approval"></span>
                  ) : act.type === "execute_request" ? (
                    <span className="w-2 h-2 rounded-full bg-cyan-400 inline-block" title="Execution"></span>
                  ) : act.type === "cancel_request" ? (
                    <span className="w-2 h-2 rounded-full bg-slate-650 inline-block" title="Cancellation"></span>
                  ) : (
                    <span className="w-2 h-2 rounded-full bg-cyan-400 inline-block" title="Register"></span>
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <span className="text-slate-200 font-medium">{act.details}</span>{" "}
                  <span className="text-slate-500 text-[10px] font-mono">
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
