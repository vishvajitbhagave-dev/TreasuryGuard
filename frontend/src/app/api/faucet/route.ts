import { NextRequest, NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import { CONTRACTS } from "../../stellar";

const execPromise = promisify(exec);

export async function POST(req: NextRequest) {
  try {
    const { address } = await req.json();
    if (!address) {
      return NextResponse.json({ error: "Address is required" }, { status: 400 });
    }

    // Call the Stellar Asset Contract's mint function:
    // fn mint(env: Env, to: Address, amount: i128)
    const cmd = `stellar contract invoke --id ${CONTRACTS.tokenId} --source deployer --network testnet -- mint --to ${address} --amount 5000`;

    console.log("Executing faucet command:", cmd);
    const { stdout, stderr } = await execPromise(cmd);
    console.log("Faucet output:", stdout);
    if (stderr) console.error("Faucet stderr:", stderr);

    return NextResponse.json({
      success: true,
      message: "Successfully minted 5,000 USDC to your wallet!",
      hash: stdout.trim()
    });
  } catch (err: unknown) {
    console.error("Faucet error details:", err);
    const errorMessage = err instanceof Error ? err.message : "Failed to execute faucet transaction. Make sure the deployer account is funded.";
    return NextResponse.json({
      error: errorMessage
    }, { status: 500 });
  }
}
