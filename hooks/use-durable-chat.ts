"use client";

import { useChat } from "@ai-sdk/react";
import { WorkflowChatTransport } from "@ai-sdk/workflow/client";
import type { UIMessage } from "ai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * `useChat` wired to a durable workflow chat endpoint.
 *
 * - Streams through `WorkflowChatTransport`, which reconnects to the same
 *   workflow run (`{api}/{runId}/stream`) when a connection drops mid-reply.
 * - Persists the conversation and the in-flight run ID in localStorage, so a
 *   page refresh restores the history and re-attaches to a reply that was
 *   still streaming — replaying it once instead of re-sending the message.
 *
 * Each chat passes its own `storageKey`, keeping conversations separate.
 */
export function useDurableChat<M extends UIMessage>({
  api,
  storageKey,
}: {
  api: string;
  storageKey: string;
}) {
  const messagesKey = `${storageKey}:messages`;
  const runKey = `${storageKey}:active-run`;
  const activeRun = useRef<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  const setActiveRun = useCallback(
    (runId: string | null) => {
      activeRun.current = runId;
      writeStorage(runKey, runId);
    },
    [runKey],
  );

  const transport = useMemo(
    () =>
      new WorkflowChatTransport<M>({
        api,
        maxConsecutiveErrors: 5,
        onChatSendMessage: (response) => {
          setActiveRun(response.headers.get("x-workflow-run-id"));
        },
        onChatEnd: () => setActiveRun(null),
        // After a refresh the transport only knows the chat ID; point it at
        // the run that was in flight.
        prepareReconnectToStreamRequest: ({ api: defaultApi }) => ({
          api: activeRun.current
            ? `${api}/${encodeURIComponent(activeRun.current)}/stream`
            : defaultApi,
        }),
      }),
    [api, setActiveRun],
  );

  const chat = useChat<M>({
    id: storageKey,
    transport,
    experimental_throttle: 50,
    onError: () => setActiveRun(null),
  });
  const { messages, setMessages, resumeStream, status } = chat;

  // Restore once on mount (client only, so server and first client render match).
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    const stored = readStorage<M[]>(messagesKey) ?? [];
    const runId = readStorage<string>(runKey);
    if (runId) {
      // Drop the partial reply; replaying the run rebuilds it exactly once.
      const lastUser = stored.findLastIndex((m) => m.role === "user");
      setMessages(stored.slice(0, lastUser + 1));
      activeRun.current = runId;
      void resumeStream();
    } else if (stored.length > 0) {
      setMessages(stored);
    }
    setHydrated(true);
  }, [messagesKey, runKey, resumeStream, setMessages]);

  // Persist after every change once restored (never clobber with the empty initial state).
  useEffect(() => {
    if (hydrated) writeStorage(messagesKey, messages);
  }, [hydrated, messages, messagesKey]);

  const reset = useCallback(() => {
    void chat.stop();
    setActiveRun(null);
    setMessages([]);
    chat.clearError();
    writeStorage(messagesKey, null);
  }, [chat, messagesKey, setActiveRun, setMessages]);

  const isBusy = status === "submitted" || status === "streaming";

  return { ...chat, hydrated, isBusy, reset };
}

function readStorage<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: unknown) {
  try {
    if (value === null || (Array.isArray(value) && value.length === 0)) {
      window.localStorage.removeItem(key);
    } else {
      window.localStorage.setItem(key, JSON.stringify(value));
    }
  } catch {
    // Storage can be unavailable (private mode, quota); the chat still works.
  }
}
