import { useState, useEffect } from "react";
import { projectId, publicAnonKey } from "/utils/supabase/info";

const API = `https://${projectId}.supabase.co/functions/v1/make-server-54299934`;

// Fallback: direct public URL pattern (works if buckets are public)
const PUBLIC_BASE = `https://${projectId}.supabase.co/storage/v1/object/public`;

type UrlMap = Record<string, string>;

interface ScreenshotUrls {
  sampleshots: UrlMap;
  marketingshots: UrlMap;
  loading: boolean;
}

// Module-level cache so multiple components share the same fetch
let _cache: { sampleshots: UrlMap; marketingshots: UrlMap } | null = null;
let _promise: Promise<{ sampleshots: UrlMap; marketingshots: UrlMap }> | null =
  null;

function fetchUrls(): Promise<{
  sampleshots: UrlMap;
  marketingshots: UrlMap;
}> {
  if (_cache) return Promise.resolve(_cache);
  if (_promise) return _promise;

  _promise = fetch(`${API}/screenshot-urls`, {
    headers: { Authorization: `Bearer ${publicAnonKey}` },
  })
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    })
    .then((data) => {
      const urls = data.urls || {};
      _cache = {
        sampleshots: urls.sampleshots || {},
        marketingshots: urls.marketingshots || {},
      };
      return _cache;
    })
    .catch((err) => {
      console.error("[useScreenshotUrls] Failed to fetch signed URLs:", err);
      // Fallback to public URL pattern
      _cache = {
        sampleshots: Object.fromEntries(
          [
            "tradeamm.png",
            "swap.png",
            "wallet.png",
            "DAO.png",
            "vip.png",
            "bridges.png",
          ].map((f) => [f, `${PUBLIC_BASE}/sampleshots/${f}`])
        ),
        marketingshots: Object.fromEntries(
          [
            "screendark.png",
            "screenlight.png",
            "mobildark.png",
            "mobilelight.png",
          ].map((f) => [f, `${PUBLIC_BASE}/marketingshots/${f}`])
        ),
      };
      return _cache;
    });

  return _promise;
}

export function useScreenshotUrls(): ScreenshotUrls {
  const [data, setData] = useState<{
    sampleshots: UrlMap;
    marketingshots: UrlMap;
  } | null>(_cache);

  useEffect(() => {
    fetchUrls().then(setData);
  }, []);

  return {
    sampleshots: data?.sampleshots || {},
    marketingshots: data?.marketingshots || {},
    loading: !data,
  };
}
