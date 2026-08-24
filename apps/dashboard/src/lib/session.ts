import { createContext, useContext } from "react";

/** Session customer yang sudah terautentikasi (dari /auth/me). */
export type Session = {
  userId: string;
  email: string;
  role: string;
  isAdmin: boolean;
  orgName: string | null;
  planTier: string | null;
};

export const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const s = useContext(SessionContext);
  if (!s) throw new Error("useSession di luar SessionContext.Provider");
  return s;
}

/** Dev/demo fallback: X-User-Id dari localStorage (sesuai perilaku lama). */
export const USER_ID_KEY = "aee-user-id";
export const DEFAULT_USER = "25896200-49df-453f-9138-71caf6fb90f2";

export function resolveUserId(session: Session | null): string {
  if (session?.userId) return session.userId;
  try {
    return localStorage.getItem(USER_ID_KEY) || DEFAULT_USER;
  } catch {
    return DEFAULT_USER;
  }
}
