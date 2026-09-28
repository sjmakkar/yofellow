import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { Routes, Route, Navigate, NavLink, useNavigate } from "react-router-dom";
import { api, tokenStore, type Me, type PublicUser } from "./api";
import { getSocket, closeSocket } from "./socket";
import Login from "./pages/Login";
import Profile from "./pages/Profile";
import Trips from "./pages/Trips";
import TripDetail from "./pages/TripDetail";
import Chats from "./pages/Chats";
import Chat from "./pages/Chat";
import NetBadge from "./components/NetBadge";
import Games from "./pages/Games";
import Play from "./pages/Play";
import Solo from "./pages/Solo";
import CabGroup from "./pages/CabGroup";
import { startOutbox } from "./lib/outbox";
import { registerDeviceKey } from "./lib/keys";
import { wireGroupSync } from "./lib/group";
import { clearAll, kvSet } from "./lib/idb";
import { cached } from "./api";

type Ctx = {
  me: Me | null;
  setMe: (m: Me | null) => void;
  logout: () => void;
  toast: (msg: string) => void;
};
const AppCtx = createContext<Ctx>(null as any);
export const useApp = () => useContext(AppCtx);

export default function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(!!tokenStore.get());
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const nav = useNavigate();

  const toast = useCallback((msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3200);
  }, []);

  useEffect(() => {
    if (!tokenStore.get()) return;
    api<Me>("/me")
      .then(setMe)
      .catch(async () => {
        // Offline start: use the cached profile if we have one.
        const m = await cached<Me>("/me");
        if (m) setMe(m);
        else tokenStore.set(null);
      })
      .finally(() => setLoading(false));
  }, []);

  // Keep the profile cached so the app can start with no network.
  useEffect(() => {
    if (me) kvSet("GET /me", me);
  }, [me]);

  // Offline machinery: outbox, device key for signed group messages, group sync.
  useEffect(() => {
    if (!me) return;
    startOutbox();
    registerDeviceKey();
    wireGroupSync(() => me.id);
  }, [me?.id]);

  // Global realtime notifications
  useEffect(() => {
    if (!me) return;
    const s = getSocket();
    if (!s) return;
    const onWave = (d: { from: PublicUser }) => toast(`👋 ${d.from.name} waved at you`);
    const onMatch = (d: { matchId: number; with: PublicUser }) => {
      toast(`🎉 You matched with ${d.with.name}!`);
    };
    const onCabRequest = (d: { from: PublicUser }) => toast(`🚕 ${d.from.name} wants to share your cab`);
    const onCabUpdate = (d: { accepted?: boolean }) => d.accepted !== undefined && toast(d.accepted ? "🚕 You're in! Your cab share was accepted" : "🚕 Your cab request was declined");
    s.on("wave", onWave);
    s.on("match", onMatch);
    s.on("cab:request", onCabRequest);
    s.on("cab:update", onCabUpdate);
    return () => {
      s.off("wave", onWave);
      s.off("match", onMatch);
      s.off("cab:request", onCabRequest);
      s.off("cab:update", onCabUpdate);
    };
  }, [me, toast]);

  const logout = () => {
    clearAll();
    tokenStore.set(null);
    closeSocket();
    setMe(null);
    nav("/");
  };

  if (loading) return <div className="center muted">Loading…</div>;

  return (
    <AppCtx.Provider value={{ me, setMe, logout, toast }}>
      <div className="shell">
        {me && <NetBadge />}
        {!me ? (
          <Login />
        ) : !me.complete ? (
          <Profile onboarding />
        ) : (
          <>
            <main className="content">
              <Routes>
                <Route path="/" element={<Trips />} />
                <Route path="/trips/:id" element={<TripDetail />} />
                <Route path="/chats" element={<Chats />} />
                <Route path="/chats/:id" element={<Chat />} />
                <Route path="/profile" element={<Profile />} />
                <Route path="/games" element={<Games />} />
                <Route path="/play/:id" element={<Play />} />
                <Route path="/solo/:kind" element={<Solo />} />
                <Route path="/groups/:id" element={<CabGroup />} />
                <Route path="*" element={<Navigate to="/" />} />
              </Routes>
            </main>
            <nav className="tabbar">
              <NavLink to="/" end>
                <span>🧳</span>Trips
              </NavLink>
              <NavLink to="/chats">
                <span>💬</span>Chats
              </NavLink>
              <NavLink to="/games">
                <span>🎮</span>Games
              </NavLink>
              <NavLink to="/profile">
                <span>🙂</span>Me
              </NavLink>
            </nav>
          </>
        )}
        {toastMsg && <div className="toast">{toastMsg}</div>}
      </div>
    </AppCtx.Provider>
  );
}
