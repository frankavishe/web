import { io, type Socket } from "socket.io-client";
import { API_ORIGIN, refreshSession } from "@/lib/api/client";
import type { DeviceRevokedEvent, ProfileUpdatedEvent } from "@/lib/api/types";
import { useAuthStore } from "@/stores/auth";

interface ServerToClient {
  "device:revoked": (e: DeviceRevokedEvent) => void;
  "profile:updated": (e: ProfileUpdatedEvent) => void;
  "auth:expired": (e: Record<string, never>) => void;
}

// No client-to-server events in feature 001.
type ClientToServer = Record<string, never>;

export interface RealtimeHandlers {
  onDeviceRevoked: (e: DeviceRevokedEvent) => void;
  onProfileUpdated: (e: ProfileUpdatedEvent) => void;
}

export type RealtimeSocket = Socket<ServerToClient, ClientToServer>;

/**
 * Connects to the `/rt` namespace with the current access token.
 *
 * The server disconnects on `auth:expired`, and rejects the handshake with `connect_error`
 * (`data.code` UNAUTHORIZED | SESSION_REVOKED). Socket.IO does not reconnect by itself in
 * either case, so we refresh the access token and call `connect()` again.
 *
 * Returns a function that closes the connection.
 */
export function connectRealtime(handlers: RealtimeHandlers): () => void {
  let closed = false;

  const socket: RealtimeSocket = io(`${API_ORIGIN}/rt`, {
    // Evaluated on every (re)connect, so a refreshed token is picked up.
    auth: (cb) => cb({ token: useAuthStore.getState().accessToken }),
    transports: ["websocket"],
  });

  async function refreshAndReconnect() {
    const token = await refreshSession();
    if (closed) return;
    if (token) socket.connect();
    // No token: the store is now signedOut and the app layout navigates to sign-in.
  }

  // Only ever sent to this device's own room (device:{id}).
  socket.on("device:revoked", handlers.onDeviceRevoked);
  socket.on("profile:updated", handlers.onProfileUpdated);
  socket.on("auth:expired", () => void refreshAndReconnect());

  socket.on("connect_error", (err) => {
    if (closed) return;
    const code = (err as Error & { data?: { code?: string } }).data?.code;
    if (code === "SESSION_REVOKED") {
      handlers.onDeviceRevoked({
        deviceId: useAuthStore.getState().deviceId ?? "",
        reason: "signed_out",
      });
    } else if (code === "UNAUTHORIZED") {
      void refreshAndReconnect();
    }
    // Other errors (network) are retried by Socket.IO's own reconnection.
  });

  return () => {
    closed = true;
    socket.removeAllListeners();
    socket.disconnect();
  };
}
