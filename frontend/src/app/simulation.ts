import { VaultConfig, SpendingRequest, ActivityLog } from "./types";

export interface SimState {
  config: VaultConfig;
  members: string[];
  requests: SpendingRequest[];
  balance: string;
  activities: ActivityLog[];
  userBalances: { [address: string]: string };
}

// Predefined mock addresses
export const SIM_ACCOUNTS = {
  ADMIN: "G-ADMIN-VAULTLINK-XXXXXXXXXXXXXX-ADM",
  ALICE: "G-ALICE-MEMBER-XXXXXXXXXXXXXXX-ALC",
  BOB: "G-BOB-MEMBER-XXXXXXXXXXXXXXXXX-BOB",
  CHARLIE: "G-CHARLIE-MEMBER-XXXXXXXXXXXXX-CHA",
  RECIPIENT: "G-RECIPIENT-MERCHANT-XXXXXXXXX-REC",
};

// Member roles mirrored from the on-chain contract (feature: member roles)
export const SIM_ROLES: { [address: string]: string } = {
  [SIM_ACCOUNTS.ADMIN]: "owner",
  [SIM_ACCOUNTS.ALICE]: "contributor",
  [SIM_ACCOUNTS.BOB]: "approver",
  [SIM_ACCOUNTS.CHARLIE]: "viewer",
};

const DEFAULT_STATE: SimState = {
  config: {
    admin: SIM_ACCOUNTS.ADMIN,
    token: "C-MOCK-USDC-TOKEN-XXXXXXXXXXXXX-USD",
    registry: "C-REGISTRY-CONTRACT-XXXXXXXXXXX-REG",
    threshold: 2,
    name: "Team Treasury",
    purpose: "Shared multi-sig fund for group expenses",
  },
  members: [SIM_ACCOUNTS.ALICE, SIM_ACCOUNTS.BOB, SIM_ACCOUNTS.CHARLIE],
  requests: [
    {
      id: 1,
      recipient: SIM_ACCOUNTS.RECIPIENT,
      amount: "1500",
      category: "Infrastructure",
      description: "Server hosting and infrastructure bill - Q3",
      approvalsCount: 1,
      status: 0, // Pending
      createdAt: Date.now() - 3600000 * 24, // 1 day ago
      proposer: SIM_ACCOUNTS.ALICE,
    },
    {
      id: 2,
      recipient: "G-DEVELOPER-FEE-XXXXXXXXXXXXXXX-DEV",
      amount: "2500",
      category: "Payroll",
      description: "Frontend development services - Milestone 1",
      approvalsCount: 2,
      status: 1, // Executed
      createdAt: Date.now() - 3600000 * 12, // 12 hours ago
      proposer: SIM_ACCOUNTS.ALICE,
    },
    {
      id: 3,
      recipient: "G-MARKETING-AGENCY-XXXXXXXXXXXXX-MKT",
      amount: "800",
      category: "Marketing",
      description: "Social media ad campaign (cancelled)",
      approvalsCount: 0,
      status: 2, // Cancelled
      createdAt: Date.now() - 3600000 * 3, // 3 hours ago
      proposer: SIM_ACCOUNTS.ALICE,
    },
  ],
  balance: "8500",
  activities: [
    {
      id: "a1",
      timestamp: Date.now() - 3600000 * 25,
      type: "vault_registered",
      user: SIM_ACCOUNTS.ADMIN,
      details: "Vault contract registered with registry contract",
    },
    {
      id: "a2",
      timestamp: Date.now() - 3600000 * 24.5,
      type: "deposit",
      user: SIM_ACCOUNTS.ADMIN,
      details: "Deposited 11,000 USDC into vault",
    },
    {
      id: "a3",
      timestamp: Date.now() - 3600000 * 24,
      type: "submit_request",
      user: SIM_ACCOUNTS.ALICE,
      details: "Submitted Request #1: Server hosting for 1,500 USDC",
    },
    {
      id: "a4",
      timestamp: Date.now() - 3600000 * 23,
      type: "approve_request",
      user: SIM_ACCOUNTS.BOB,
      details: "Approved Request #1",
    },
    {
      id: "a5",
      timestamp: Date.now() - 3600000 * 12,
      type: "submit_request",
      user: SIM_ACCOUNTS.ALICE,
      details: "Submitted Request #2: Frontend development for 2,500 USDC",
    },
    {
      id: "a6",
      timestamp: Date.now() - 3600000 * 11.5,
      type: "approve_request",
      user: SIM_ACCOUNTS.BOB,
      details: "Approved Request #2",
    },
    {
      id: "a7",
      timestamp: Date.now() - 3600000 * 11,
      type: "approve_request",
      user: SIM_ACCOUNTS.ADMIN,
      details: "Approved Request #2 (Threshold met)",
    },
    {
      id: "a8",
      timestamp: Date.now() - 3600000 * 10,
      type: "execute_request",
      user: SIM_ACCOUNTS.ADMIN,
      details: "Executed Request #2. Transferred 2,500 USDC to recipient",
    },
  ],
  userBalances: {
    [SIM_ACCOUNTS.ADMIN]: "25000",
    [SIM_ACCOUNTS.ALICE]: "1200",
    [SIM_ACCOUNTS.BOB]: "800",
    [SIM_ACCOUNTS.CHARLIE]: "3000",
  },
};

// Key used to store simulated blockchain state in localStorage
const STORAGE_KEY = "vaultlink_simulation_state";

export const getSimulationState = (): SimState => {
  if (typeof window === "undefined") return DEFAULT_STATE;
  const data = localStorage.getItem(STORAGE_KEY);
  if (!data) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_STATE));
    return DEFAULT_STATE;
  }
  try {
    return JSON.parse(data);
  } catch {
    return DEFAULT_STATE;
  }
};

const saveSimulationState = (state: SimState) => {
  if (typeof window !== "undefined") {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }
};

export const resetSimulation = (): SimState => {
  saveSimulationState(DEFAULT_STATE);
  return DEFAULT_STATE;
};

export const simulatedDeposit = (from: string, amount: number): SimState => {
  const state = getSimulationState();
  const balanceVal = parseFloat(state.balance) + amount;
  state.balance = balanceVal.toString();

  // Deduct from sender's wallet balance
  const userBal = parseFloat(state.userBalances[from] || "0") - amount;
  state.userBalances[from] = Math.max(0, userBal).toString();

  // Log activity
  const newActivity: ActivityLog = {
    id: `a${Date.now()}`,
    timestamp: Date.now(),
    type: "deposit",
    user: from,
    details: `Deposited ${amount} USDC into the vault`,
  };
  state.activities = [newActivity, ...state.activities];
  saveSimulationState(state);
  return state;
};

export const simulatedSubmitRequest = (
  proposer: string,
  recipient: string,
  amount: number,
  category: string,
  description: string
): SimState => {
  const state = getSimulationState();
  const nextId = state.requests.length > 0 ? Math.max(...state.requests.map((r) => r.id)) + 1 : 1;

  const newRequest: SpendingRequest = {
    id: nextId,
    recipient,
    amount: amount.toString(),
    category,
    description,
    approvalsCount: 0,
    status: 0, // Pending
    createdAt: Date.now(),
    proposer,
  };

  state.requests = [newRequest, ...state.requests];

  const newActivity: ActivityLog = {
    id: `a${Date.now()}`,
    timestamp: Date.now(),
    type: "submit_request",
    user: proposer,
    details: `Submitted Request #${nextId} [${category}]: ${description} for ${amount} USDC`,
  };
  state.activities = [newActivity, ...state.activities];
  saveSimulationState(state);
  return state;
};

export const simulatedApproveRequest = (
  approver: string,
  requestId: number,
  // We'll also track approvals in local storage to prevent duplicate votes
  sessionKey = `approved_${requestId}_${approver}`
): SimState => {
  const state = getSimulationState();
  const requestIndex = state.requests.findIndex((r) => r.id === requestId);

  if (requestIndex === -1) return state;
  const request = state.requests[requestIndex];

  // Prevent voting on executed/cancelled requests
  if (request.status !== 0) return state;

  // Simulate unique key check
  if (typeof window !== "undefined" && localStorage.getItem(sessionKey)) {
    // Already approved by this user in session simulation
    return state;
  }

  if (typeof window !== "undefined") {
    localStorage.setItem(sessionKey, "true");
  }

  request.approvalsCount += 1;
  state.requests[requestIndex] = { ...request };

  const newActivity: ActivityLog = {
    id: `a${Date.now()}`,
    timestamp: Date.now(),
    type: "approve_request",
    user: approver,
    details: `Approved Request #${requestId} (Total approvals: ${request.approvalsCount})`,
  };
  state.activities = [newActivity, ...state.activities];
  saveSimulationState(state);
  return state;
};

export const simulatedExecuteRequest = (
  executor: string,
  requestId: number
): SimState => {
  const state = getSimulationState();
  const requestIndex = state.requests.findIndex((r) => r.id === requestId);

  if (requestIndex === -1) return state;
  const request = state.requests[requestIndex];

  if (request.status !== 0) return state;
  if (request.approvalsCount < state.config.threshold) return state;

  const reqAmount = parseFloat(request.amount);
  const vaultBal = parseFloat(state.balance);

  if (vaultBal < reqAmount) {
    // Cannot execute due to insufficient balance
    const errorActivity: ActivityLog = {
      id: `a${Date.now()}`,
      timestamp: Date.now(),
      type: "execution_failed",
      user: executor,
      details: `Failed to execute Request #${requestId}: Insufficient vault balance`,
    };
    state.activities = [errorActivity, ...state.activities];
    saveSimulationState(state);
    return state;
  }

  // Deduct from vault and complete
  state.balance = (vaultBal - reqAmount).toString();
  request.status = 1; // Executed
  state.requests[requestIndex] = { ...request };

  const newActivity: ActivityLog = {
    id: `a${Date.now()}`,
    timestamp: Date.now(),
    type: "execute_request",
    user: executor,
    details: `Executed Request #${requestId}. Transferred ${request.amount} USDC to ${request.recipient}`,
  };
  state.activities = [newActivity, ...state.activities];
  saveSimulationState(state);
  return state;
};

export const simulatedCancelRequest = (
  canceller: string,
  requestId: number
): SimState => {
  const state = getSimulationState();
  const requestIndex = state.requests.findIndex((r) => r.id === requestId);

  if (requestIndex === -1) return state;
  const request = state.requests[requestIndex];

  if (request.status !== 0) return state;

  // Set status to cancelled
  request.status = 2; // Cancelled
  state.requests[requestIndex] = { ...request };

  const newActivity: ActivityLog = {
    id: `a${Date.now()}`,
    timestamp: Date.now(),
    type: "cancel_request",
    user: canceller,
    details: `Cancelled Request #${requestId}`,
  };
  state.activities = [newActivity, ...state.activities];
  saveSimulationState(state);
  return state;
};
