import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";
import { userForToken, type User } from "./auth";
import type { Db } from "./db";
import { allowed, roleOn } from "./perms";
import { head } from "./store";

interface Client {
  ws: WebSocket;
  user: User;
}

export type HubEvent =
  | { type: "hello"; rev: number; presence: string[] }
  | { type: "revision"; rev: number; author: string; commands: unknown[]; restored?: number }
  | { type: "presence"; presence: string[] }
  | { type: "preview"; state: string };

/**
 * Live updates, server -> browser only. Edits always go through the HTTP command endpoint, so the
 * socket can never be used to change a project, only to hear about changes and see who is here.
 */
export class Hub {
  private rooms = new Map<string, Set<Client>>();

  presence(projectId: string): string[] {
    return [...new Set([...(this.rooms.get(projectId) ?? [])].map((c) => c.user.username))].sort();
  }

  broadcast(projectId: string, event: HubEvent): void {
    const msg = JSON.stringify(event);
    for (const c of this.rooms.get(projectId) ?? []) if (c.ws.readyState === WebSocket.OPEN) c.ws.send(msg);
  }

  attach(server: Server, db: Db): { close(): void } {
    const wss = new WebSocketServer({ noServer: true });
    const reject = (socket: Duplex, status: string) => {
      socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
      socket.destroy();
    };
    const onUpgrade = (req: IncomingMessage, socket: Duplex, headBuf: Buffer) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (url.pathname !== "/ws") return reject(socket, "404 Not Found");
      const cookie = /(?:^|;\s*)rw_sid=([^;]+)/.exec(req.headers.cookie ?? "")?.[1];
      const user = userForToken(db, cookie);
      const projectId = url.searchParams.get("project") ?? "";
      if (!user) return reject(socket, "401 Unauthorized");
      if (!allowed(roleOn(db, user.id, projectId), "read")) return reject(socket, "403 Forbidden");
      wss.handleUpgrade(req, socket, headBuf, (ws) => this.join(db, projectId, { ws, user }));
    };
    server.on("upgrade", onUpgrade);
    return {
      close: () => {
        server.off("upgrade", onUpgrade);
        for (const room of this.rooms.values()) for (const c of room) c.ws.terminate();
        wss.close();
      },
    };
  }

  private join(db: Db, projectId: string, client: Client): void {
    const room = this.rooms.get(projectId) ?? new Set<Client>();
    this.rooms.set(projectId, room);
    room.add(client);
    client.ws.send(JSON.stringify({ type: "hello", rev: head(db, projectId).rev, presence: this.presence(projectId) } satisfies HubEvent));
    this.broadcast(projectId, { type: "presence", presence: this.presence(projectId) });
    client.ws.on("close", () => {
      room.delete(client);
      if (!room.size) this.rooms.delete(projectId);
      else this.broadcast(projectId, { type: "presence", presence: this.presence(projectId) });
    });
    client.ws.on("message", () => {}); // read-only channel: anything the client sends is ignored
  }
}
