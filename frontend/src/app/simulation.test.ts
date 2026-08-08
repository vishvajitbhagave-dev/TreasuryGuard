import { describe, it, expect, beforeEach } from "vitest";
import {
  getSimulationState,
  simulatedDeposit,
  simulatedSubmitRequest,
  simulatedApproveRequest,
  simulatedExecuteRequest,
  simulatedCancelRequest,
  resetSimulation,
  SIM_ACCOUNTS
} from "./simulation";

describe("VaultLink Frontend Simulation Engine Tests", () => {
  beforeEach(() => {
    // Reset simulation state and clear storage before each test
    if (typeof window !== "undefined") {
      localStorage.clear();
    }
    resetSimulation();
  });

  it("should initialize and retrieve default simulation state", () => {
    const state = getSimulationState();
    expect(state).toBeDefined();
    expect(state.balance).toBe("8500");
    expect(state.members).toContain(SIM_ACCOUNTS.ALICE);
    expect(state.members).toContain(SIM_ACCOUNTS.BOB);
    expect(state.members).toContain(SIM_ACCOUNTS.CHARLIE);
    expect(state.config.threshold).toBe(2);
  });

  it("should process a simulated deposit correctly", () => {
    const initialWalletBalance = parseFloat(getSimulationState().userBalances[SIM_ACCOUNTS.ALICE] || "0");
    const depositAmount = 500;

    const newState = simulatedDeposit(SIM_ACCOUNTS.ALICE, depositAmount);

    // Vault reserves should increase
    expect(newState.balance).toBe("9000");

    // Sender's balance should decrease
    const expectedWalletBalance = initialWalletBalance - depositAmount;
    expect(parseFloat(newState.userBalances[SIM_ACCOUNTS.ALICE])).toBe(expectedWalletBalance);

    // Deposit activity should be logged
    expect(newState.activities[0].type).toBe("deposit");
    expect(newState.activities[0].user).toBe(SIM_ACCOUNTS.ALICE);
    expect(newState.activities[0].details).toContain("Deposited 500 USDC");
  });

  it("should submit a spending request correctly", () => {
    const stateBefore = getSimulationState();
    const recipient = SIM_ACCOUNTS.RECIPIENT;
    const amount = 1000;
    const description = "Office supplies";

    const newState = simulatedSubmitRequest(SIM_ACCOUNTS.ALICE, recipient, amount, description);

    // Proposal count should increase
    expect(newState.requests.length).toBe(stateBefore.requests.length + 1);

    // New request should be added at the top (index 0)
    const newReq = newState.requests[0];
    expect(newReq.description).toBe(description);
    expect(newReq.amount).toBe("1000");
    expect(newReq.recipient).toBe(recipient);
    expect(newReq.proposer).toBe(SIM_ACCOUNTS.ALICE);
    expect(newReq.status).toBe(0); // Pending

    // Activity log should update
    expect(newState.activities[0].type).toBe("submit_request");
    expect(newState.activities[0].details).toContain("Submitted Request");
  });

  it("should process a proposal approval correctly", () => {
    const state = getSimulationState();
    const pendingReqId = 1; // Request #1 is pending in default state
    const targetReq = state.requests.find(r => r.id === pendingReqId);
    expect(targetReq).toBeDefined();
    const initialApprovals = targetReq!.approvalsCount;

    // Simulate approval by Bob
    const newState = simulatedApproveRequest(SIM_ACCOUNTS.BOB, pendingReqId, `approved_${pendingReqId}_${SIM_ACCOUNTS.BOB}`);
    const updatedReq = newState.requests.find(r => r.id === pendingReqId);

    expect(updatedReq!.approvalsCount).toBe(initialApprovals + 1);
    expect(newState.activities[0].type).toBe("approve_request");
    expect(newState.activities[0].details).toContain("Approved Request #1");
  });

  it("should execute a proposal when threshold is met and vault balance is sufficient", () => {
    const pendingReqId = 1; // Request #1 is pending
    
    // Request #1 requires threshold = 2. It starts with 1 approval.
    // Let's approve it as Bob to meet the threshold of 2.
    simulatedApproveRequest(SIM_ACCOUNTS.BOB, pendingReqId, `approved_${pendingReqId}_${SIM_ACCOUNTS.BOB}`);

    const state = getSimulationState();
    const req = state.requests.find(r => r.id === pendingReqId);
    expect(req!.approvalsCount).toBe(2); // Met threshold

    const initialVaultBalance = parseFloat(state.balance); // starts at 8500
    const requestAmount = parseFloat(req!.amount); // 1500

    // Execute the request
    const newState = simulatedExecuteRequest(SIM_ACCOUNTS.ADMIN, pendingReqId);
    const executedReq = newState.requests.find(r => r.id === pendingReqId);

    expect(executedReq!.status).toBe(1); // Executed
    expect(parseFloat(newState.balance)).toBe(initialVaultBalance - requestAmount); // 7000
    expect(newState.activities[0].type).toBe("execute_request");
    expect(newState.activities[0].details).toContain("Executed Request #1");
  });

  it("should fail execution if vault balance is insufficient", () => {
    // Submit a request for an amount larger than the vault balance
    simulatedSubmitRequest(SIM_ACCOUNTS.ALICE, SIM_ACCOUNTS.RECIPIENT, 50000, "Huge buy");
    const state = getSimulationState();
    const newReqId = state.requests[0].id;

    // Approve it twice to meet the threshold of 2
    simulatedApproveRequest(SIM_ACCOUNTS.ALICE, newReqId, `approved_${newReqId}_${SIM_ACCOUNTS.ALICE}`);
    simulatedApproveRequest(SIM_ACCOUNTS.BOB, newReqId, `approved_${newReqId}_${SIM_ACCOUNTS.BOB}`);

    // Attempt execution
    const newState = simulatedExecuteRequest(SIM_ACCOUNTS.ADMIN, newReqId);
    const updatedReq = newState.requests.find(r => r.id === newReqId);

    expect(updatedReq!.status).toBe(0); // Remains pending
    expect(newState.activities[0].type).toBe("execution_failed");
    expect(newState.activities[0].details).toContain("Insufficient vault balance");
  });

  it("should allow proposer or admin to cancel a pending request", () => {
    const pendingReqId = 1; // Request #1 proposer is Alice

    const newState = simulatedCancelRequest(SIM_ACCOUNTS.ALICE, pendingReqId);
    const cancelledReq = newState.requests.find(r => r.id === pendingReqId);

    expect(cancelledReq!.status).toBe(2); // Cancelled
    expect(newState.activities[0].type).toBe("cancel_request");
  });
});
