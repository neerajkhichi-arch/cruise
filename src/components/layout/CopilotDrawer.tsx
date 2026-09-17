"use client";

import { useState, useRef, useEffect } from "react";
import { X, Sparkles, Send, Loader2, Check, XCircle } from "lucide-react";
import { cn } from "@/lib/format";

interface CopilotAction {
  label: string;
  type: "APPLY_BUDGET_CHANGE";
  cityId: string;
  cityName: string;
  currentBudget: number;
  newBudget: number;
}

interface Message {
  role: "user" | "assistant";
  content: string;
  action?: CopilotAction;
  actionState?: "pending" | "approved" | "rejected";
}

const SUGGESTED = [
  "Why is Chandigarh CPL increasing?",
  "Which city should get more budget?",
  "Which vehicles are wasting spend?",
  "Show cities with CPL below ₹80",
  "Recommend how I should allocate ₹5 lakh this month",
];

export function CopilotDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", content: "Hi! I'm your AI Marketing Copilot. Ask me about city performance, budget allocation, or underperforming vehicles — I'll answer using your live campaign data." },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, open]);

  async function ask(question: string) {
    if (!question.trim() || loading) return;
    setMessages((m) => [...m, { role: "user", content: question }]);
    setInput("");
    setLoading(true);
    try {
      const res = await fetch("/api/copilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });
      const data = await res.json();
      setMessages((m) => [...m, { role: "assistant", content: data.answer, action: data.action, actionState: data.action ? "pending" : undefined }]);
    } catch {
      setMessages((m) => [...m, { role: "assistant", content: "Sorry, I couldn't reach the analytics engine just now." }]);
    } finally {
      setLoading(false);
    }
  }

  async function resolveAction(idx: number, approve: boolean) {
    const msg = messages[idx];
    if (!msg.action) return;
    if (approve) {
      await fetch("/api/budget-allocation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ changes: [{ cityId: msg.action.cityId, newBudget: msg.action.newBudget }] }),
      });
    }
    setMessages((m) => m.map((x, i) => (i === idx ? { ...x, actionState: approve ? "approved" : "rejected" } : x)));
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-ink-950/20" onClick={onClose} />
      <div className="relative w-full max-w-md bg-white h-full shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-4 h-16 border-b border-ink-100">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-brand-600" />
            <span className="font-semibold text-ink-900">AI Marketing Copilot</span>
          </div>
          <button onClick={onClose} className="btn-ghost !px-2">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {messages.map((m, i) => (
            <div key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
              <div className={cn("max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed", m.role === "user" ? "bg-brand-600 text-white" : "bg-ink-50 text-ink-800")}>
                <p>{m.content}</p>
                {m.action && (
                  <div className="mt-2.5 pt-2.5 border-t border-black/10">
                    <p className="text-xs font-medium mb-2">{m.action.label}</p>
                    {m.actionState === "pending" && (
                      <div className="flex gap-2">
                        <button onClick={() => resolveAction(i, true)} className="flex items-center gap-1 rounded-md bg-white text-ink-800 px-2.5 py-1 text-xs font-medium hover:bg-ink-100">
                          <Check className="h-3 w-3" /> Approve
                        </button>
                        <button onClick={() => resolveAction(i, false)} className="flex items-center gap-1 rounded-md text-ink-500 px-2.5 py-1 text-xs font-medium hover:bg-black/5">
                          <XCircle className="h-3 w-3" /> Cancel
                        </button>
                      </div>
                    )}
                    {m.actionState === "approved" && <span className="chip chip-positive">Applied</span>}
                    {m.actionState === "rejected" && <span className="chip chip-neutral">Cancelled</span>}
                  </div>
                )}
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex justify-start">
              <div className="bg-ink-50 rounded-2xl px-3.5 py-2.5">
                <Loader2 className="h-4 w-4 animate-spin text-ink-400" />
              </div>
            </div>
          )}
        </div>

        <div className="px-4 pb-2 flex flex-wrap gap-1.5">
          {SUGGESTED.slice(0, 3).map((s) => (
            <button key={s} onClick={() => ask(s)} className="text-xs rounded-full border border-ink-200 px-2.5 py-1 text-ink-600 hover:bg-ink-50">
              {s}
            </button>
          ))}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            ask(input);
          }}
          className="p-4 border-t border-ink-100 flex gap-2"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about performance, budget, inventory…"
            className="input flex-1"
          />
          <button type="submit" className="btn-primary !px-3" disabled={loading}>
            <Send className="h-4 w-4" />
          </button>
        </form>
      </div>
    </div>
  );
}
