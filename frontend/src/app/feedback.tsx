"use client";

import { useState } from "react";

interface FeedbackWidgetProps {
  walletAddress: string | null;
  networkMode: string;
}

const CATEGORIES = [
  { value: "general", label: "General" },
  { value: "bug", label: "Bug Report" },
  { value: "feature", label: "Feature Request" },
  { value: "ux", label: "UX Improvement" },
];

export default function FeedbackWidget({ walletAddress, networkMode }: FeedbackWidgetProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [rating, setRating] = useState<number>(0);
  const [hoveredStar, setHoveredStar] = useState<number>(0);
  const [category, setCategory] = useState("general");
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async () => {
    if (rating === 0 || message.trim().length < 3) return;
    setIsSubmitting(true);

    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rating,
          message: message.trim(),
          category,
          walletAddress: walletAddress || "anonymous",
          networkMode,
        }),
      });

      const data = await res.json();
      if (data.success) {
        setSubmitted(true);
        setTimeout(() => {
          setIsOpen(false);
          setSubmitted(false);
          setRating(0);
          setMessage("");
          setCategory("general");
        }, 2500);
      }
    } catch {
      // Feedback is best-effort — fail silently
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      {/* Floating feedback button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed bottom-6 right-6 z-50 bg-cyan-600 hover:bg-cyan-500 text-white w-12 h-12 rounded-full shadow-lg shadow-cyan-900/40 flex items-center justify-center transition-all hover:scale-105"
        title="Send Feedback"
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
        </svg>
      </button>

      {/* Feedback panel */}
      {isOpen && (
        <div className="fixed bottom-20 right-6 z-50 w-80 glass-panel rounded-xl p-5 animate-fade-in border border-slate-800/60">
          {submitted ? (
            <div className="text-center py-6">
              <div className="text-3xl mb-2">🎉</div>
              <p className="text-sm font-semibold text-cyan-400">Thank you for your feedback!</p>
              <p className="text-xs text-slate-400 mt-1">Your input helps us improve VaultLink.</p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-white">Send Feedback</h3>
                <button onClick={() => setIsOpen(false)} className="text-slate-500 hover:text-slate-300 transition-colors">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Star rating */}
              <div className="mb-3">
                <label className="text-[10px] uppercase font-mono text-slate-400 font-bold tracking-wider">Rating</label>
                <div className="flex gap-1 mt-1.5">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button
                      key={star}
                      onMouseEnter={() => setHoveredStar(star)}
                      onMouseLeave={() => setHoveredStar(0)}
                      onClick={() => setRating(star)}
                      className="transition-transform hover:scale-110"
                    >
                      <svg
                        className={`w-6 h-6 ${
                          star <= (hoveredStar || rating) ? "text-amber-400" : "text-slate-700"
                        }`}
                        fill="currentColor"
                        viewBox="0 0 20 20"
                      >
                        <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                      </svg>
                    </button>
                  ))}
                </div>
              </div>

              {/* Category */}
              <div className="mb-3">
                <label className="text-[10px] uppercase font-mono text-slate-400 font-bold tracking-wider">Category</label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="mt-1.5 w-full bg-slate-900/80 border border-slate-700/50 rounded-lg px-3 py-2 text-xs text-slate-200 outline-none focus:border-cyan-500/50 transition-colors"
                >
                  {CATEGORIES.map((cat) => (
                    <option key={cat.value} value={cat.value}>{cat.label}</option>
                  ))}
                </select>
              </div>

              {/* Message */}
              <div className="mb-4">
                <label className="text-[10px] uppercase font-mono text-slate-400 font-bold tracking-wider">Message</label>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Tell us what you think..."
                  rows={3}
                  className="mt-1.5 w-full bg-slate-900/80 border border-slate-700/50 rounded-lg px-3 py-2 text-xs text-slate-200 outline-none focus:border-cyan-500/50 transition-colors resize-none placeholder:text-slate-600"
                />
              </div>

              {/* Submit */}
              <button
                onClick={handleSubmit}
                disabled={isSubmitting || rating === 0 || message.trim().length < 3}
                className="w-full py-2.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white shadow-lg disabled:from-slate-800 disabled:to-slate-800 disabled:text-slate-500 disabled:cursor-not-allowed"
              >
                {isSubmitting ? "Submitting..." : "Submit Feedback"}
              </button>
            </>
          )}
        </div>
      )}
    </>
  );
}
