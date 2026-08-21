import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { rating, message, category, walletAddress, networkMode } = body;

    if (!rating || typeof rating !== "number" || rating < 1 || rating > 5) {
      return NextResponse.json({ error: "Rating must be a number between 1 and 5." }, { status: 400 });
    }

    if (!message || typeof message !== "string" || message.trim().length < 3) {
      return NextResponse.json({ error: "Feedback message must be at least 3 characters." }, { status: 400 });
    }

    const feedback = {
      timestamp: new Date().toISOString(),
      rating,
      category: category || "general",
      message: message.trim(),
      walletAddress: walletAddress || "anonymous",
      networkMode: networkMode || "unknown",
    };

    console.log("[Feedback Received]", JSON.stringify(feedback));

    return NextResponse.json({
      success: true,
      message: "Thank you for your feedback!",
      id: `fb_${Date.now()}`,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : "Failed to submit feedback";
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}
