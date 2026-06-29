"use client";

import { useEffect, useState } from "react";
import { getSession, onAuthChange } from "../../lib/auth";
import LoginPage from "./LoginPage";

export default function AuthGuard({ children }) {
  const [session, setSession] = useState(undefined);

  useEffect(() => {
    getSession().then(setSession);
    const { data: listener } = onAuthChange(setSession);
    return () => listener?.subscription?.unsubscribe();
  }, []);

  if (session === undefined) {
    return (
      <div className="h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-brand border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!session) {
    return <LoginPage />;
  }

  return children;
}
