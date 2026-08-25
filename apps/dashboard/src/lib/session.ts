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

export function useSession(): Session | null {
  return useContext(SessionContext);
}

export function useSessionRequired(): Session {
  const s = useContext(SessionContext);
  if (!s) throw new Error("useSessionRequired di luar SessionContext.Provider");
  return s;
}
