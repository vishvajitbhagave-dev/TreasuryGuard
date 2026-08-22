export interface VaultConfig {
  admin: string;
  token: string;
  registry: string;
  threshold: number;
  name: string;
  purpose: string;
}

export interface SpendingRequest {
  id: number;
  recipient: string;
  amount: string; // Keep as string for display of big numbers
  category: string;
  description: string;
  approvalsCount: number;
  status: 0 | 1 | 2; // 0 = Pending, 1 = Executed, 2 = Cancelled
  createdAt: number;
  proposer: string;
}

export interface ActivityLog {
  id: string;
  timestamp: number;
  type: string;
  user: string;
  details?: string;
}

export type NetworkMode = "simulation" | "testnet";

export interface WalletState {
  address: string | null;
  balance: string;
  xlmBalance?: string;
  isConnected: boolean;
  error: string | null;
  walletProvider?: string;
  walletName?: string;
}
