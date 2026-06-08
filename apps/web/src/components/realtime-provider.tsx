"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { io, type Socket } from "socket.io-client";
import { useAuth } from "@/components/providers";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

interface RealtimeContextValue {
  /** The live socket once connected (null while disconnected / logged out). */
  socket: Socket | null;
  /** Set of userIds currently online (≥1 active socket) — drives the
   *  green presence dots. */
  onlineUserIds: Set<string>;
}

const RealtimeContext = createContext<RealtimeContextValue>({
  socket: null,
  onlineUserIds: new Set(),
});

/**
 * Connects to the realtime gateway (presence + live message sync) once
 * the user is authenticated. The socket.io handshake carries the
 * `access_token` cookie (withCredentials), so no token plumbing is
 * needed — the BE verifies the same JWT the REST API uses.
 *
 * Must sit inside AuthProvider. Disconnects + clears presence on logout.
 */
export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id;
  const [socket, setSocket] = useState<Socket | null>(null);
  const [onlineUserIds, setOnlineUserIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!userId) {
      setSocket(null);
      setOnlineUserIds(new Set());
      return;
    }
    const s = io(API_URL, { withCredentials: true });
    setSocket(s);

    s.on("presence:state", (d: { online: string[] }) => {
      setOnlineUserIds(new Set(d.online));
    });
    s.on("presence:online", (d: { userId: string }) => {
      setOnlineUserIds((prev) => {
        const next = new Set(prev);
        next.add(d.userId);
        return next;
      });
    });
    s.on("presence:offline", (d: { userId: string }) => {
      setOnlineUserIds((prev) => {
        const next = new Set(prev);
        next.delete(d.userId);
        return next;
      });
    });

    return () => {
      s.disconnect();
      setSocket(null);
      setOnlineUserIds(new Set());
    };
  }, [userId]);

  return (
    <RealtimeContext.Provider value={{ socket, onlineUserIds }}>
      {children}
    </RealtimeContext.Provider>
  );
}

export function useRealtime() {
  return useContext(RealtimeContext);
}

/** Convenience: the set of online userIds (for presence dots). */
export function useOnlineUsers() {
  return useContext(RealtimeContext).onlineUserIds;
}

/**
 * Join a conversation's realtime room and run `onRemoteMessage` whenever
 * another member's message is persisted there. Pass a stable callback
 * (useCallback). No-ops until the socket is connected.
 */
export function useConversationLiveSync(
  conversationId: string | null,
  currentUserId: string | undefined,
  onRemoteMessage: () => void,
) {
  const { socket } = useRealtime();

  useEffect(() => {
    if (!socket || !conversationId) return;
    socket.emit("conversation:join", { conversationId });

    const handler = (d: { conversationId: string; senderId: string | null }) => {
      // Only react to this conversation, and skip our own messages
      // (the sender already has them — optimistic UI / live stream).
      if (d.conversationId !== conversationId) return;
      if (d.senderId && d.senderId === currentUserId) return;
      onRemoteMessage();
    };
    socket.on("message:new", handler);

    return () => {
      socket.emit("conversation:leave", { conversationId });
      socket.off("message:new", handler);
    };
  }, [socket, conversationId, currentUserId, onRemoteMessage]);
}
