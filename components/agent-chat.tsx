"use client";

/**
 * Storefront shopping chat, shown in the right-hand agent panel.
 *
 * Talks to the shopping agent at `/api/chat` through a durable workflow
 * transport (see `useDurableChat`), and renders tool results as product
 * cards, product details, and return confirmations.
 */
import { useCallback, useState } from "react";
import { Bot, RotateCcw } from "lucide-react";
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
import { ChatErrorNotice } from "@/components/chat/chat-error-notice";
import {
  CategoriesPart,
  ProductDetailsPart,
  ProductSearchPart,
  ReturnOrderPart,
} from "@/components/chat/shop-tool-parts";
import { Button } from "@/components/ui/button";
import { useSidebar } from "@/components/ui/sidebar";
import { useDurableChat } from "@/hooks/use-durable-chat";
import type { ShoppingAgentUIMessage } from "@/lib/agent";

const SUGGESTIONS = [
  "What hoodies do you have?",
  "Show me something for my desk",
  "I'd like to return an order",
];

type Part = ShoppingAgentUIMessage["parts"][number];

export function AgentChat() {
  const { isMobile, setOpenMobile } = useSidebar();
  const onNavigate = useCallback(() => {
    if (isMobile) setOpenMobile(false);
  }, [isMobile, setOpenMobile]);

  const { messages, sendMessage, status, error, isBusy, regenerate, reset } =
    useDurableChat<ShoppingAgentUIMessage>({
      api: "/api/chat",
      storageKey: "ship-it-shop:shopping-chat",
    });
  const [input, setInput] = useState("");

  const send = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isBusy) return;
    void sendMessage({ text: trimmed });
    setInput("");
  };

  const handleSubmit = (message: PromptInputMessage) => send(message.text);

  const lastMessage = messages.at(-1);
  const awaitingReply = isBusy && lastMessage?.role === "user";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-end border-b px-3 py-1.5">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={reset}
          disabled={messages.length === 0}
          className="h-7 gap-1.5 text-xs text-muted-foreground"
        >
          <RotateCcw className="size-3.5" aria-hidden="true" />
          New chat
        </Button>
      </div>

      <Conversation className="flex-1" aria-label="Shopping assistant conversation">
        <ConversationContent className="gap-6">
          {messages.length === 0 ? (
            <ConversationEmptyState
              icon={<Bot className="size-8" aria-hidden="true" />}
              title="Hi! I'm the Ship It Shop assistant"
              description="Ask me to find products, explain an item, or start a return."
            />
          ) : (
            messages.map((message) => (
              <Message key={message.id} from={message.role}>
                <MessageContent className="w-full">
                  {message.parts.map((part, index) => (
                    <ShopMessagePart
                      key={`${message.id}-${index}`}
                      part={part}
                      role={message.role}
                      onNavigate={onNavigate}
                    />
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
              message="The assistant couldn't finish that reply."
              onRetry={() => void regenerate()}
            />
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <div className="flex flex-col gap-2 border-t p-3">
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
              placeholder="Ask about products or returns…"
              aria-label="Message the shopping assistant"
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

function ShopMessagePart({
  part,
  role,
  onNavigate,
}: {
  part: Part;
  role: ShoppingAgentUIMessage["role"];
  onNavigate: () => void;
}) {
  switch (part.type) {
    case "text":
      return role === "user" ? (
        <p className="whitespace-pre-wrap">{part.text}</p>
      ) : (
        <MessageResponse>{part.text}</MessageResponse>
      );
    case "tool-searchProducts":
      return <ProductSearchPart part={part} onNavigate={onNavigate} />;
    case "tool-getProductDetails":
      return <ProductDetailsPart part={part} onNavigate={onNavigate} />;
    case "tool-getAllCategories":
      return <CategoriesPart part={part} onNavigate={onNavigate} />;
    case "tool-returnOrder":
      return <ReturnOrderPart part={part} />;
    default:
      return null;
  }
}
