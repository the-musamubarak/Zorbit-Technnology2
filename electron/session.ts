// This is the crux of "secure" for a single-laptop offline app: the renderer
// (your React UI, running in a sandboxed, no-Node-access window) must never
// be trusted to say "I'm an admin." If we let it pass its own role into IPC
// calls, a modified request or a compromised renderer could claim admin and
// bypass every check in repository.ts.
//
// Instead: login() sets the session HERE, in the main process. Every IPC
// handler reads role/userId from this session — never from what the
// renderer sends — so spoofing is not possible without actually compromising
// the main process itself (a much higher bar).
//
// One session at a time is fine for this app: it's one laptop, one login at
// a time, matching how the shop will actually use it (someone logs in at
// the counter, logs out at end of shift).

import type { Role } from "./db/repository";

export type Session = {
  userId: string;
  fullName: string;
  email: string;
  role: Role;
};

let currentSession: Session | null = null;

export function setSession(session: Session | null): void {
  currentSession = session;
}

export function getSession(): Session | null {
  return currentSession;
}

export function requireSession(): Session {
  if (!currentSession) throw new Error("Not logged in");
  return currentSession;
}
