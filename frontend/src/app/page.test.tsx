import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import Home from "./page";
import * as stellar from "./stellar";

// Mock the stellar module
vi.mock("./stellar", async (importOriginal) => {
  const actual = await importOriginal<typeof stellar>();
  return {
    ...actual,
    isFreighterInstalled: vi.fn().mockResolvedValue(true),
    connectWallet: vi.fn().mockResolvedValue("GACYFFEF6TV4MNCRW5LYZ57PO6V3CAVZMGYBEHD4MG6IPYVXENE4XJQO"),
    fetchContractConfig: vi.fn().mockResolvedValue({
      admin: "GACYFFEF6TV4MNCRW5LYZ57PO6V3CAVZMGYBEHD4MG6IPYVXENE4XJQO",
      token: "CDUSDC",
      registry: "CAB12XYZ",
      threshold: 2,
    }),
    fetchVaultBalance: vi.fn().mockResolvedValue("15000"),
    fetchContractRequests: vi.fn().mockResolvedValue([]),
    fetchTokenBalance: vi.fn().mockResolvedValue("2500"),
    fetchXlmBalance: vi.fn().mockResolvedValue("100"),
    fetchContractEvents: vi.fn().mockResolvedValue([]),
  };
});

describe("VaultLink Home Page Component", () => {
  it("renders the dashboard header and title", async () => {
    render(<Home />);
    
    // Check that header elements render, waiting for async state resolution
    expect(await screen.findByText("VaultLink")).toBeDefined();
    expect(screen.getByText("Soroban Multi-Signature Treasury Control")).toBeDefined();
    expect(screen.getByText("Secure V2")).toBeDefined();
  });

  it("displays sandbox tips when in simulation mode", async () => {
    render(<Home />);
    
    // Default mode is simulation
    expect(await screen.findByText("Sandbox Playground Guides")).toBeDefined();
    expect(screen.getByText("Reset Sandbox State")).toBeDefined();
  });

  it("allows switching identity in simulation mode", async () => {
    render(<Home />);
    
    const select = await screen.findByLabelText("Simulate As:") as HTMLSelectElement;
    expect(select).toBeDefined();
    expect(select.value).toBe("G-ALICE-MEMBER-XXXXXXXXXXXXXXX-ALC"); // Alice is default
    
    // Switch to Bob
    fireEvent.change(select, { target: { value: "G-BOB-MEMBER-XXXXXXXXXXXXXXXXX-BOB" } });
    expect(select.value).toBe("G-BOB-MEMBER-XXXXXXXXXXXXXXXXX-BOB");
  });

  it("should show form validations correctly on submit proposal", async () => {
    render(<Home />);
    
    const submitBtn = await screen.findByRole("button", { name: "Submit Spending Request" });
    expect(submitBtn).toBeDefined();
    
    // The button is disabled initially because forms are empty
    expect(submitBtn.hasAttribute("disabled")).toBe(true);
  });
});
