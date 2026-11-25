"use client";

/**
 * Store admin agent chat at `/admin`.
 *
 * Talks to the admin agent at `/api/admin/chat` through a durable workflow
 * transport. Its conversation is stored separately from the storefront chat.
 * Back-office results render as data tables and sandbox commands as terminal
 * output.
 */
import { useState } from "react";
import { BarChart3, RotateCcw } from "lucide-react";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  type PromptInputMessage,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "@/components/ai-elements/prompt-input";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { Suggestion, Suggestions } from "@/components/ai-elements/suggestion";
import {
  AdminProductDetailsPart,
  BashPart,
  InventoryStockPart,
  ReturnsHistoryPart,
  SalesAnalyticsPart,
  SaveMemoryPart,
  SupportTicketsPart,
} from "@/components/chat/admin-tool-parts";
import { ChatErrorNotice } from "@/components/chat/chat-error-notice";
import { CategoriesPart, ProductSearchPart } from "@/components/chat/shop-tool-parts";
import { Button } from "@/components/ui/button";
import { useDurableChat } from "@/hooks/use-durable-chat";
import type { AdminAgentUIMessage } from "@/lib/agent";

const SUGGESTIONS = [
  "Which low-stock products are top sellers?",
  "Which products had the highest return rate in the last 30 days?",
  "Summarize open urgent support tickets",
  "How did revenue this week compare to last week?",
];

type Part = AdminAgentUIMessage["parts"][number];

export function AdminAgentChat() {
  const { messages, sendMessage, status, error, isBusy, regenerate, reset } =
    useDurableChat<AdminAgentUIMessage>({
      api: "/api/admin/chat",
      storageKey: "ship-it-shop:admin-chat",
    });
  const [input, setInput] = useState("");

  const send = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isBusy) return;
    void sendMessage({ text: trimmed });
    setInput("");
  };

  const handleSubmit = (message: PromptInputMessage) => send(message.text);
  const awaitingReply = isBusy && messages.at(-1)?.role === "user";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b px-3 py-1.5">
        <p className="text-xs text-muted-foreground">Read-only access to store data</p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={reset}
          disabled={messages.length === 0}
          className="h-7 gap-1.5 text-xs text-muted-foreground"
        >
          <RotateCcw className="size-3.5" aria-hidden="true" />
          New conversation
        </Button>
      </div>

      <Conversation className="flex-1" aria-label="Admin agent conversation">
        <ConversationContent className="gap-6">
          {messages.length === 0 ? (
            <ConversationEmptyState
              icon={<BarChart3 className="size-8" aria-hidden="true" />}
              title="Investigate store operations"
              description="Ask about support tickets, returns, inventory, or sales. Calculations run in an isolated sandbox, and I remember preferences you share."
            />
          ) : (
            messages.map((message) => (
              <Message key={message.id} from={message.role}>
                <MessageContent className="w-full">
                  {message.parts.map((part, index) => (
                    <AdminMessagePart key={`${message.id}-${index}`} part={part} role={message.role} />
                  ))}
                </MessageContent>
              </Message>
            ))
          )}
          {awaitingReply && (
            <div role="status" className="text-sm">
              <Shimmer as="span">Thinking…</Shimmer>
            </div>
          )}
          {error && (
            <ChatErrorNotice
              message="The admin agent couldn't finish that answer."
              onRetry={() => void regenerate()}
            />
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <div className="flex flex-col gap-3 border-t p-3">
        {messages.length === 0 && (
          <Suggestions aria-label="Suggested questions">
            {SUGGESTIONS.map((s) => (
              <Suggestion key={s} suggestion={s} onClick={send} />
            ))}
          </Suggestions>
        )}
        <PromptInput onSubmit={handleSubmit}>
          <PromptInputBody>
            <PromptInputTextarea
              value={input}
              onChange={(e) => setInput(e.currentTarget.value)}
              placeholder="Ask the admin agent…"
              aria-label="Message the admin agent"
            />
          </PromptInputBody>
          <PromptInputFooter>
            <PromptInputTools />
            <PromptInputSubmit
              status={isBusy ? status : "ready"}
              disabled={isBusy || !input.trim()}
            />
          </PromptInputFooter>
        </PromptInput>
      </div>
    </div>
  );
}

function AdminMessagePart({ part, role }: { part: Part; role: AdminAgentUIMessage["role"] }) {
  switch (part.type) {
    case "text":
      return role === "user" ? (
        <p className="whitespace-pre-wrap">{part.text}</p>
      ) : (
        <MessageResponse>{part.text}</MessageResponse>
      );
    case "tool-getSupportTickets":
      return <SupportTicketsPart part={part} />;
    case "tool-getReturnsHistory":
      return <ReturnsHistoryPart part={part} />;
    case "tool-getInventoryStock":
      return <InventoryStockPart part={part} />;
    case "tool-getSalesAnalytics":
      return <SalesAnalyticsPart part={part} />;
    case "tool-bash":
      return <BashPart part={part} />;
    case "tool-saveMemory":
      return <SaveMemoryPart part={part} />;
    case "tool-searchProducts":
      return <ProductSearchPart part={part} />;
    case "tool-getAllCategories":
      return <CategoriesPart part={part} />;
    case "tool-getProductDetails":
      return <AdminProductDetailsPart part={part} />;
    default:
      return null;
  }
}
