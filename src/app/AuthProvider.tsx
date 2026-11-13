import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, type User } from "firebase/auth";
import { doc, getDoc, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import { clearCache } from "../repositories/cache";
import { toProfile } from "../repositories/usersRepo";
import { clearLocalData, initSync } from "../services/offline/sync";
import { auth, db } from "../services/firebase/init";
import type { UserProfile } from "../types";

interface AuthState {
  user: User | null; profile: UserProfile | null; loading: boolean;
  /** Active account with a profile (SUPER_ADMIN or USER). */ hasAccess: boolean;
  isSuper: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  logOut: () => Promise<void>;
}
const AuthContext = createContext<AuthState | null>(null);

async function loadProfile(u: User, markLogin: boolean): Promise<UserProfile | null> {
  if (!db) return null;
  const ref = doc(db, "users", u.uid);
  let snap = await getDoc(ref).catch(() => null);
  if (snap && !snap.exists()) {
    // The original Super Admin has no profile yet. Firestore rules allow this single self-registration ONLY for the bootstrap email; anyone else is refused.
    try {
      await setDoc(ref, { uid: u.uid, fullName: u.displayName || u.email || "", email: u.email ?? "", role: "SUPER_ADMIN", isActive: true, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), lastLoginAt: null });
      snap = await getDoc(ref);
    } catch { return null; }
  }
  if (!snap?.exists()) return null;
  const p = toProfile(snap.id, snap.data());
  if (markLogin && p.isActive) void updateDoc(ref, { lastLoginAt: serverTimestamp() }).catch(() => undefined);
  return p;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!auth) { setLoading(false); return; }
    return onAuthStateChanged(auth, (u) => {
      setUser(u);
      initSync(u?.uid ?? null);
      if (!u) { setProfile(null); setLoading(false); return; }
      setLoading(true);
      void loadProfile(u, true).then(setProfile).finally(() => setLoading(false));
    });
  }, []);
  // Re-check the account when the tab is used again, so a disabled account loses access quickly (the rules already block its data).
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible" && user) void loadProfile(user, false).then(setProfile); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [user]);
  const logOut = useCallback(async () => {
    clearCache(); if (auth) await signOut(auth);
    if (await clearLocalData()) window.location.reload(); // shared computers: remove cached data unless changes are still waiting to sync
  }, []);

  const hasAccess = !!profile && profile.isActive;
  const value: AuthState = {
    user, profile, loading, hasAccess, isSuper: hasAccess && profile?.role === "SUPER_ADMIN",
    signIn: async (email, password) => {
      if (!auth) throw new Error("Firebase is not configured.");
      await signInWithEmailAndPassword(auth, email, password);
    },
    logOut,
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
