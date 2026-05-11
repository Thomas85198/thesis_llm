"use client";

import { MessageCircleIcon, SendIcon, SparklesIcon } from "lucide-react";
import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  ChatRateLimitError,
  sendChat,
  type ChatMessage,
} from "@/lib/api";
import { cn } from "@/lib/utils";

const MAX_INPUT_CHARS = 2000;

const SUGGESTIONS = [
  "這篇論文的核心 claim 是什麼？",
  "幫我整理目前發現的最嚴重缺陷",
  "Method 章節有沒有沒交代清楚的步驟？",
  "REL-09 為什麼會抓到這個段落？",
];

type Props = {
  paperId: string;
  onEduClick?: (eduId: string) => void;
  onDefectClick?: (defectId: string) => void;
};

type UIMessage = ChatMessage & {
  /** Citations parsed from the model output, for the assistant message. */
  citedEduIds?: string[];
  citedDefectIds?: string[];
};

export function ChatDrawer({ paperId, onEduClick, onDefectClick }: Props) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Keep input scrolled to newest message.
  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, sending]);

  // Auto-focus on open.
  useEffect(() => {
    if (open) {
      // Slight delay so the sheet animation finishes.
      const t = setTimeout(() => textareaRef.current?.focus(), 80);
      return () => clearTimeout(t);
    }
  }, [open]);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || sending) return;
      if (trimmed.length > MAX_INPUT_CHARS) {
        toast.error(`訊息過長（上限 ${MAX_INPUT_CHARS} 字）`);
        return;
      }

      const nextHistory: UIMessage[] = [
        ...messages,
        { role: "user", content: trimmed },
      ];
      setMessages(nextHistory);
      setInput("");
      setSending(true);
      try {
        const res = await sendChat(
          paperId,
          nextHistory.map(({ role, content }) => ({ role, content }))
        );
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: res.reply || "(空回覆)",
            citedEduIds: res.cited_edu_ids,
            citedDefectIds: res.cited_defect_ids,
          },
        ]);
      } catch (err) {
        if (err instanceof ChatRateLimitError) {
          toast.error(`聊天頻率過快，請 ${err.retryAfter} 秒後再試`);
        } else {
          toast.error("聊天失敗", {
            description: err instanceof Error ? err.message : String(err),
          });
        }
        // Roll back the user message so they can retry.
        setMessages((prev) => prev.slice(0, -1));
        setInput(trimmed);
      } finally {
        setSending(false);
      }
    },
    [messages, paperId, sending]
  );

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send(input);
    }
  }

  function reset() {
    setMessages([]);
    setInput("");
  }

  return (
    <>
      {/* Floating trigger button — bottom-right corner */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "fixed bottom-5 right-5 z-40 flex h-12 items-center gap-2 rounded-full",
          "bg-primary px-4 text-primary-foreground shadow-lg transition-all",
          "hover:scale-105 hover:shadow-xl active:scale-95",
          open && "pointer-events-none opacity-0"
        )}
        aria-label="開啟論文助手"
      >
        <MessageCircleIcon className="h-5 w-5" />
        <span className="hidden text-sm font-medium sm:inline">論文助手</span>
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="right"
          className="flex w-full flex-col gap-0 p-0 sm:max-w-md"
        >
          <SheetHeader className="border-b">
            <SheetTitle className="flex items-center gap-2">
              <SparklesIcon className="h-4 w-4 text-primary" />
              論文助手
            </SheetTitle>
            <SheetDescription>
              只能討論這篇論文的內容與檢出的缺陷。回答會引用 [EDU:xxx] / [DEFECT:xxx]。
            </SheetDescription>
          </SheetHeader>

          {/* Message list */}
          <div
            ref={scrollRef}
            className="flex-1 space-y-3 overflow-y-auto px-4 py-3"
          >
            {messages.length === 0 && (
              <EmptyState onPick={(t) => void send(t)} />
            )}
            {messages.map((m, i) => (
              <MessageBubble
                key={i}
                message={m}
                onEduClick={onEduClick}
                onDefectClick={onDefectClick}
              />
            ))}
            {sending && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
                助手思考中…
              </div>
            )}
          </div>

          {/* Footer: input */}
          <div className="border-t bg-background p-3">
            <div className="flex items-end gap-2">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value.slice(0, MAX_INPUT_CHARS))}
                onKeyDown={handleKeyDown}
                placeholder="問這篇論文一個問題…（Enter 送出 / Shift+Enter 換行）"
                rows={2}
                className={cn(
                  "min-h-[44px] flex-1 resize-none rounded-md border bg-background px-3 py-2",
                  "text-sm leading-relaxed",
                  "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
                  "disabled:cursor-not-allowed disabled:opacity-50"
                )}
                disabled={sending}
                maxLength={MAX_INPUT_CHARS}
              />
              <Button
                size="icon"
                onClick={() => void send(input)}
                disabled={sending || !input.trim()}
                aria-label="送出"
              >
                <SendIcon className="h-4 w-4" />
              </Button>
            </div>
            <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
              <span>
                {input.length}/{MAX_INPUT_CHARS}
              </span>
              {messages.length > 0 && (
                <button
                  type="button"
                  onClick={reset}
                  className="hover:text-foreground"
                >
                  清空對話
                </button>
              )}
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

function EmptyState({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="space-y-3 py-6 text-center">
      <p className="text-sm text-muted-foreground">
        試試問問看：
      </p>
      <div className="space-y-1.5">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onPick(s)}
            className={cn(
              "block w-full rounded-md border bg-card px-3 py-2 text-left text-xs",
              "transition-colors hover:bg-accent"
            )}
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

function MessageBubble({
  message,
  onEduClick,
  onDefectClick,
}: {
  message: UIMessage;
  onEduClick?: (eduId: string) => void;
  onDefectClick?: (defectId: string) => void;
}) {
  const isUser = message.role === "user";
  return (
    <div
      className={cn(
        "rounded-lg px-3 py-2 text-sm leading-relaxed",
        isUser ? "ml-6 bg-primary/10" : "mr-6 border bg-card"
      )}
    >
      <div className="mb-0.5 text-[10px] font-medium uppercase text-muted-foreground">
        {isUser ? "你" : "助手"}
      </div>
      {isUser ? (
        // User input is plain text — preserve whitespace, no markdown parsing.
        <div className="whitespace-pre-wrap break-words">{message.content}</div>
      ) : (
        <AssistantMarkdown
          text={message.content}
          onEduClick={onEduClick}
          onDefectClick={onDefectClick}
        />
      )}
    </div>
  );
}

/** Render assistant reply as markdown + replace [EDU:xxx] / [DEFECT:xxx] / [page:N] inline. */
function AssistantMarkdown({
  text,
  onEduClick,
  onDefectClick,
}: {
  text: string;
  onEduClick?: (eduId: string) => void;
  onDefectClick?: (defectId: string) => void;
}) {
  // Walk children of any block element; if a child is a string, split out citations.
  const processChildren = (children: ReactNode): ReactNode => {
    if (typeof children === "string") return renderCitations(children, onEduClick, onDefectClick);
    if (Array.isArray(children)) {
      return children.map((c, i) =>
        typeof c === "string" ? (
          <Fragment key={i}>{renderCitations(c, onEduClick, onDefectClick)}</Fragment>
        ) : (
          <Fragment key={i}>{c}</Fragment>
        )
      );
    }
    return children;
  };

  return (
    <div
      className={cn(
        "break-words text-sm leading-relaxed",
        // Compact prose styling (mirrors @tailwindcss/typography but inline so we
        // don't add a dependency just for chat bubbles).
        "[&_p]:my-1.5 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0",
        "[&_ul]:my-1.5 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-0.5",
        "[&_ol]:my-1.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:space-y-0.5",
        "[&_li>p]:my-0",
        "[&_h1]:mt-3 [&_h1]:mb-1.5 [&_h1]:text-base [&_h1]:font-semibold",
        "[&_h2]:mt-3 [&_h2]:mb-1.5 [&_h2]:text-sm [&_h2]:font-semibold",
        "[&_h3]:mt-2 [&_h3]:mb-1 [&_h3]:text-sm [&_h3]:font-semibold",
        "[&_strong]:font-semibold [&_em]:italic",
        "[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[11px]",
        "[&_pre]:my-1.5 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-zinc-950 [&_pre]:p-2 [&_pre]:text-[11px] [&_pre]:text-zinc-100",
        "[&_pre_code]:bg-transparent [&_pre_code]:p-0",
        "[&_blockquote]:my-1.5 [&_blockquote]:border-l-2 [&_blockquote]:border-muted-foreground/30 [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:text-muted-foreground",
        "[&_a]:text-primary [&_a]:underline",
        "[&_hr]:my-2 [&_hr]:border-border",
        "[&_table]:my-2 [&_table]:w-full [&_table]:overflow-x-auto [&_table]:rounded [&_table]:border [&_table]:text-xs",
        "[&_th]:border-b [&_th]:bg-muted/40 [&_th]:p-1.5 [&_th]:text-left [&_th]:font-medium",
        "[&_td]:border-t [&_td]:p-1.5 [&_td]:align-top"
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p>{processChildren(children)}</p>,
          li: ({ children }) => <li>{processChildren(children)}</li>,
          td: ({ children }) => <td>{processChildren(children)}</td>,
          th: ({ children }) => <th>{processChildren(children)}</th>,
          strong: ({ children }) => <strong>{processChildren(children)}</strong>,
          em: ({ children }) => <em>{processChildren(children)}</em>,
          h1: ({ children }) => <h1>{processChildren(children)}</h1>,
          h2: ({ children }) => <h2>{processChildren(children)}</h2>,
          h3: ({ children }) => <h3>{processChildren(children)}</h3>,
          blockquote: ({ children }) => <blockquote>{processChildren(children)}</blockquote>,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

/** Split a plain string on [EDU:xxx] / [DEFECT:xxx] / [page:N] tokens and render as chips. */
function renderCitations(
  text: string,
  onEduClick?: (eduId: string) => void,
  onDefectClick?: (defectId: string) => void
): ReactNode {
  const tokens = splitCitations(text);
  if (tokens.length === 1 && tokens[0].kind === "text") return tokens[0].value;
  return tokens.map((p, i) => {
    if (p.kind === "text") return <Fragment key={i}>{p.value}</Fragment>;
    if (p.kind === "edu") {
      return (
        <button
          key={i}
          type="button"
          onClick={() => onEduClick?.(p.id)}
          className="mx-0.5 rounded bg-primary/10 px-1 font-mono text-[10px] text-primary hover:bg-primary/20"
          title={onEduClick ? "點擊跳到該段落" : ""}
        >
          EDU:{p.id}
        </button>
      );
    }
    if (p.kind === "defect") {
      return (
        <button
          key={i}
          type="button"
          onClick={() => onDefectClick?.(p.id)}
          className="mx-0.5 rounded bg-orange-100 px-1 font-mono text-[10px] text-orange-700 hover:bg-orange-200 dark:bg-orange-950 dark:text-orange-300"
          title={onDefectClick ? "點擊聚焦該缺陷" : ""}
        >
          DEFECT:{p.id}
        </button>
      );
    }
    return (
      <span
        key={i}
        className="mx-0.5 rounded bg-muted px-1 font-mono text-[10px] text-muted-foreground"
      >
        p.{p.id}
      </span>
    );
  });
}

type Token =
  | { kind: "text"; value: string }
  | { kind: "edu"; id: string }
  | { kind: "defect"; id: string }
  | { kind: "page"; id: string };

function splitCitations(text: string): Token[] {
  const re = /\[(EDU|DEFECT|page):([^\]\s]+?)\]/g;
  const out: Token[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      out.push({ kind: "text", value: text.slice(last, m.index) });
    }
    const tag = m[1].toLowerCase();
    if (tag === "edu") out.push({ kind: "edu", id: m[2] });
    else if (tag === "defect") out.push({ kind: "defect", id: m[2] });
    else out.push({ kind: "page", id: m[2] });
    last = m.index + m[0].length;
  }
  if (last < text.length) {
    out.push({ kind: "text", value: text.slice(last) });
  }
  return out;
}
