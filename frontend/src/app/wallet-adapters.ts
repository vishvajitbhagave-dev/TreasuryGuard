import { isConnected, getAddress, signTransaction as freighterSign } from "@stellar/freighter-api";

export type WalletProviderId = "freighter" | "lobstr" | "rabet";

export interface WalletProvider {
  id: WalletProviderId;
  name: string;
  icon: string;
  isAvailable(): Promise<boolean>;
  connect(): Promise<string>;
  signTransaction(xdr: string, opts: { networkPassphrase: string; address: string }): Promise<{ signedTxXdr?: string; error?: string }>;
}

interface LobstrWallet {
  requestAccess(): Promise<{ address?: string }>;
  signTransaction(xdr: string, opts: { networkPassphrase: string; address: string }): Promise<{ signedTxXdr?: string; error?: string }>;
}

interface StellarGlobal {
  lobstr?: LobstrWallet;
}

interface RabetWallet {
  connect(): Promise<string>;
  sign(xdr: string, networkPassphrase: string): Promise<string>;
}

declare global {
  interface Window {
    stellar?: StellarGlobal;
    rabet?: RabetWallet;
  }
}

const FreighterAdapter: WalletProvider = {
  id: "freighter",
  name: "Freighter",
  icon: "🦅",
  async isAvailable() {
    if (typeof window === "undefined") return false;
    try {
      return !!(await isConnected());
    } catch {
      return false;
    }
  },
  async connect() {
    const { address, error } = await getAddress();
    if (error) throw new Error(error);
    if (!address) throw new Error("Failed to retrieve address from Freighter wallet.");
    return address;
  },
  signTransaction(xdr, opts) {
    return freighterSign(xdr, opts);
  },
};

const LOBSTRAdapter: WalletProvider = {
  id: "lobstr",
  name: "LOBSTR",
  icon: "🟢",
  async isAvailable() {
    if (typeof window === "undefined") return false;
    return !!(window.stellar?.lobstr);
  },
  async connect() {
    const lobstr = window.stellar?.lobstr;
    if (!lobstr) {
      throw new Error("LOBSTR wallet is not installed. Please install the LOBSTR extension to continue.");
    }
    try {
      const result = await lobstr.requestAccess();
      if (!result.address) {
        throw new Error("Failed to retrieve address from LOBSTR wallet.");
      }
      return result.address;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error("LOBSTR connection rejected: " + msg);
    }
  },
  async signTransaction(xdr, opts) {
    const lobstr = window.stellar?.lobstr;
    if (!lobstr) {
      return { error: "LOBSTR wallet is not available." };
    }
    try {
      const result = await lobstr.signTransaction(xdr, {
        networkPassphrase: opts.networkPassphrase,
        address: opts.address,
      });
      if (result.error) return { error: result.error };
      return { signedTxXdr: result.signedTxXdr };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { error: "LOBSTR signing failed: " + msg };
    }
  },
};

const RabetAdapter: WalletProvider = {
  id: "rabet",
  name: "Rabet",
  icon: "🔵",
  async isAvailable() {
    if (typeof window === "undefined") return false;
    return !!window.rabet;
  },
  async connect() {
    const rabet = window.rabet;
    if (!rabet) {
      throw new Error("Rabet wallet is not installed. Please install the Rabet extension to continue.");
    }
    try {
      const address = await rabet.connect();
      if (!address) {
        throw new Error("Failed to retrieve address from Rabet wallet.");
      }
      return address;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error("Rabet connection rejected: " + msg);
    }
  },
  async signTransaction(xdr, opts) {
    const rabet = window.rabet;
    if (!rabet) return { error: "Rabet wallet is not available." };
    try {
      const signed = await rabet.sign(xdr, opts.networkPassphrase);
      if (!signed) return { error: "Rabet did not return a signed transaction." };
      return { signedTxXdr: signed };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { error: "Rabet signing failed: " + msg };
    }
  },
};

export const WALLET_PROVIDERS: WalletProvider[] = [
  FreighterAdapter,
  LOBSTRAdapter,
  RabetAdapter,
];

export function getWalletProvider(id: WalletProviderId): WalletProvider {
  const provider = WALLET_PROVIDERS.find((p) => p.id === id);
  if (!provider) throw new Error(`Unknown wallet provider: ${id}`);
  return provider;
}

export async function getAvailableWallets(): Promise<WalletProvider[]> {
  const results = await Promise.all(
    WALLET_PROVIDERS.map(async (p) => ({
      provider: p,
      available: await p.isAvailable().catch(() => false),
    }))
  );
  return results.filter((r) => r.available).map((r) => r.provider);
}
