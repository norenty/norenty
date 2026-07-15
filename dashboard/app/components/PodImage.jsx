"use client";

import { useEffect, useState } from "react";
import { ImageOff } from "lucide-react";
import { supabase } from "../../lib/supabase";

const SIGNED_URL_TTL = 3600;

export default function PodImage({ path, className = "" }) {
  const [src, setSrc] = useState(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!path) return;
    supabase.storage
      .from("pods")
      .createSignedUrl(path, SIGNED_URL_TTL)
      .then(({ data, error: err }) => {
        if (err || !data?.signedUrl) { setError(true); return; }
        setSrc(data.signedUrl);
      });
  }, [path]);

  if (error) {
    return (
      <div className={`flex items-center justify-center bg-surface-alt text-ink-muted ${className}`}>
        <ImageOff size={20} />
      </div>
    );
  }

  if (!src) {
    return <div className={`bg-border animate-pulse ${className}`} />;
  }

  return (
    <img
      src={src}
      alt="Albarán"
      className={`object-cover bg-surface-alt ${className}`}
    />
  );
}
