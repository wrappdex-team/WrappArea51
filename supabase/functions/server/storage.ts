// ═══════════════════════════════════════════════════════════════════════
// STORAGE — Holiday Logos, Brand Logos, Partnered Logos (Supabase Storage)
// ═══════════════════════════════════════════════════════════════════════

import type { Hono } from "npm:hono@4.6.3";
import { createClient as createSupabaseClient } from "jsr:@supabase/supabase-js@2.49.8";
import { ROUTE_PREFIX } from "./shared.ts";
import { requireOwner, logAdminAction } from "./auth.ts";

// ── Holiday Logos ───────────────────────────────────────────────────
const HOLIDAY_BUCKET = "make-54299934-holiday-logos";
const HOLIDAY_BUCKET_LEGACY = "Holiday Wrapp Logos";
const HOLIDAY_SIGNED_URL_TTL = 3600; // 1 hour

// ── Brand Logo Bucket ───────────────────────────────────────────────
const BRAND_BUCKET = "WRAPP LOGOS";
const BRAND_SIGNED_TTL = 3600; // 1 hour

// ── Partnered Logos Bucket ─────────────────────────────────────────
const PARTNER_BUCKET = "Partnered logos";
const PARTNER_SIGNED_TTL = 3600; // 1 hour
const IMG_RE = /\.(png|jpg|jpeg|webp|svg|avif|gif)$/i;

// ── Helpers ─────────────────────────────────────────────────────────

/** Classify an error for server-side logging without leaking internals. */
function safeErrorClass(err: unknown): string {
  if (err instanceof Error) return err.constructor.name;
  return typeof err === "string" ? "StringError" : "UnknownError";
}

// ── Route Registration ──────────────────────────────────────────────

export function registerStorageRoutes(app: Hono): void {

  // ═══════════════════════════════════════════════════════════════════════
  // Holiday Logos — lists files from Supabase Storage (auto-creates bucket)
  // Checks: make-54299934-holiday-logos (preferred) → "Holiday Wrapp Logos" (legacy)
  // ═══════════════════════════════════════════════════════════════════════

  app.get(`${ROUTE_PREFIX}/holiday-logos`, async (c) => {
    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL");
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (!supabaseUrl || !serviceKey) {
        console.log("[Holiday Logos] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
        return c.json({ error: "Server configuration error" }, 500);
      }

      const supabase = createSupabaseClient(supabaseUrl, serviceKey);

      // ── Idempotent bucket creation ─────────────────────────────────
      const { data: buckets, error: listBucketsErr } = await supabase.storage.listBuckets();
      if (listBucketsErr) {
        console.log(`[Holiday Logos] Failed to list buckets: ${listBucketsErr.message}`);
        return c.json({ error: "Failed to list storage buckets" }, 502);
      }

      // Determine which bucket to use — prefer the prefixed one, fall back to legacy
      let activeBucket: string | null = null;
      const hasPrefixed = buckets?.some((b: any) => b.name === HOLIDAY_BUCKET);
      const hasLegacy = buckets?.some((b: any) => b.name === HOLIDAY_BUCKET_LEGACY);

      if (hasPrefixed) {
        activeBucket = HOLIDAY_BUCKET;
      } else if (hasLegacy) {
        activeBucket = HOLIDAY_BUCKET_LEGACY;
      } else {
        // Create the standard bucket (public so <img> tags can load directly)
        console.log(`[Holiday Logos] No bucket found — creating "${HOLIDAY_BUCKET}" (public)`);
        const { error: createErr } = await supabase.storage.createBucket(HOLIDAY_BUCKET, {
          public: true,
          fileSizeLimit: 5 * 1024 * 1024, // 5 MB
        });
        if (createErr) {
          console.log(`[Holiday Logos] Bucket creation failed: ${createErr.message}`);
          return c.json({
            error: "Holiday logo bucket creation failed",
            hint: `Upload a valentine logo to the "${HOLIDAY_BUCKET}" bucket in your Supabase dashboard.`,
          }, 502);
        }
        activeBucket = HOLIDAY_BUCKET;
      }

      console.log(`[Holiday Logos] Using bucket: "${activeBucket}"`);

      // ── List files ─────────────────────────────────────────────────
      const { data: files, error: listErr } = await supabase.storage
        .from(activeBucket)
        .list("", { limit: 200, sortBy: { column: "name", order: "asc" } });

      if (listErr) {
        console.log(`[Holiday Logos] File list failed on "${activeBucket}": ${listErr.message}`);
        return c.json({ error: "Failed to list holiday logo files", bucket: activeBucket }, 502);
      }

      const realFiles = (files || []).filter(
        (f: any) => f.name && !f.name.endsWith("/") && f.id,
      );

      console.log(`[Holiday Logos] Found ${realFiles.length} file(s) in "${activeBucket}": [${realFiles.map((f: any) => f.name).join(", ")}]`);

      if (realFiles.length === 0) {
        return c.json({ logos: [], bucket: activeBucket });
      }

      // ── Build signed URLs (works for both public & private buckets) ─
      const { data: signedUrls, error: signErr } = await supabase.storage
        .from(activeBucket)
        .createSignedUrls(
          realFiles.map((f: any) => f.name),
          HOLIDAY_SIGNED_URL_TTL,
        );

      if (signErr) {
        console.log(`[Holiday Logos] Signed URL generation failed: ${signErr.message}`);
        // Fallback: build public URLs directly
        const publicBase = `${supabaseUrl}/storage/v1/object/public/${activeBucket}`;
        const logos = realFiles.map((f: any) => ({
          name: f.name,
          url: `${publicBase}/${encodeURIComponent(f.name)}`,
        }));
        return c.json({ logos, bucket: activeBucket, urlType: "public-fallback" });
      }

      const logos = (signedUrls || [])
        .filter((s: any) => !s.error)
        .map((s: any) => ({
          name: realFiles.find((f: any) => f.name === s.path)?.name || s.path,
          url: s.signedUrl,
        }));

      return c.json({ logos, bucket: activeBucket, urlType: "signed" });
    } catch (err) {
      console.error(`[Holiday Logos] Unexpected error (${safeErrorClass(err)}):`, err);
      return c.json({ error: "Holiday logo service temporarily unavailable" }, 500);
    }
  });

  // ── Brand Logo Bucket ─────────────────────────────────────────────────
  // Lists files from "WRAPP LOGOS" and returns public + signed URLs.
  // Supports both public and private bucket configurations.

  app.get(`${ROUTE_PREFIX}/brand-logos`, async (c) => {
    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL");
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (!supabaseUrl || !serviceKey) return c.json({ error: "Missing env" }, 500);
      const supabase = createSupabaseClient(supabaseUrl, serviceKey);

      // Check if bucket exists and whether it's public
      const { data: buckets, error: bucketsErr } = await supabase.storage.listBuckets();
      if (bucketsErr) {
        console.log(`[Brand Logos] Failed to list buckets: ${bucketsErr.message}`);
        return c.json({ error: "Failed to list storage buckets" }, 502);
      }
      const bucket = buckets?.find((b: any) => b.name === BRAND_BUCKET);
      if (!bucket) {
        console.log(`[Brand Logos] Bucket "${BRAND_BUCKET}" not found`);
        return c.json({ logos: [], bucket: BRAND_BUCKET, hint: "Bucket not found" });
      }
      const isPublic = !!(bucket as any).public;

      const { data: files, error: listErr } = await supabase.storage
        .from(BRAND_BUCKET)
        .list("", { limit: 200, sortBy: { column: "name", order: "asc" } });
      if (listErr) return c.json({ error: "Failed to list brand logo files", bucket: BRAND_BUCKET }, 502);
      const realFiles = (files || []).filter((f: any) => f.name && !f.name.endsWith("/") && f.id);

      if (realFiles.length === 0) {
        return c.json({ logos: [], bucket: BRAND_BUCKET });
      }

      // For public buckets, use direct public URLs (faster, CDN-cacheable)
      if (isPublic) {
        const publicBase = `${supabaseUrl}/storage/v1/object/public/${encodeURIComponent(BRAND_BUCKET)}`;
        const logos = realFiles.map((f: any) => ({
          name: f.name,
          publicUrl: `${publicBase}/${encodeURIComponent(f.name)}`,
        }));
        console.log(`[Brand Logos] Public bucket — ${logos.length} file(s): [${logos.map((l: any) => l.name).join(", ")}]`);
        return c.json({ logos, bucket: BRAND_BUCKET, urlType: "public" });
      }

      // For private buckets, generate signed URLs
      const { data: signedUrls, error: signErr } = await supabase.storage
        .from(BRAND_BUCKET)
        .createSignedUrls(
          realFiles.map((f: any) => f.name),
          BRAND_SIGNED_TTL,
        );
      if (signErr) {
        console.log(`[Brand Logos] Signed URL error: ${signErr.message} — falling back to public pattern`);
        const publicBase = `${supabaseUrl}/storage/v1/object/public/${encodeURIComponent(BRAND_BUCKET)}`;
        const logos = realFiles.map((f: any) => ({
          name: f.name,
          publicUrl: `${publicBase}/${encodeURIComponent(f.name)}`,
        }));
        return c.json({ logos, bucket: BRAND_BUCKET, urlType: "public-fallback" });
      }

      const logos = (signedUrls || [])
        .filter((s: any) => !s.error)
        .map((s: any) => ({
          name: realFiles.find((f: any) => f.name === s.path)?.name || s.path,
          publicUrl: s.signedUrl,
        }));
      console.log(`[Brand Logos] Private bucket — ${logos.length} signed URL(s): [${logos.map((l: any) => l.name).join(", ")}]`);
      return c.json({ logos, bucket: BRAND_BUCKET, urlType: "signed" });
    } catch (err) {
      console.error(`[Brand Logos] Unexpected error (${safeErrorClass(err)}):`, err);
      return c.json({ error: "Brand logo service temporarily unavailable" }, 500);
    }
  });

  // ── Partnered Logos Bucket ────────────────────────────────────────────
  // Lists files from "Partnered logos" bucket and returns public/signed URLs.
  // The frontend matches filenames to partner keys (metamask, hashpack, etc.).

  app.get(`${ROUTE_PREFIX}/partnered-logos`, async (c) => {
    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL");
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (!supabaseUrl || !serviceKey) return c.json({ error: "Missing env" }, 500);
      const supabase = createSupabaseClient(supabaseUrl, serviceKey);

      // Step 1: Verify bucket exists
      const { data: buckets, error: bucketsErr } = await supabase.storage.listBuckets();
      if (bucketsErr) {
        console.log(`[Partnered Logos] Failed to list buckets: ${bucketsErr.message}`);
        return c.json({ error: "Failed to list storage buckets" }, 502);
      }
      const allBucketNames = (buckets || []).map((b: any) => b.name);
      console.log(`[Partnered Logos] Available buckets: [${allBucketNames.join(", ")}]`);

      const bucket = buckets?.find((b: any) => b.name === PARTNER_BUCKET);
      if (!bucket) {
        console.log(`[Partnered Logos] Bucket "${PARTNER_BUCKET}" not found`);
        return c.json({ logos: [], bucket: PARTNER_BUCKET, availableBuckets: allBucketNames, hint: "Bucket not found" });
      }
      const isPublic = !!(bucket as any).public;
      console.log(`[Partnered Logos] Bucket found — public=${isPublic}`);

      // Step 2: List all files (root level + one level of subdirectories)
      const { data: files, error: listErr } = await supabase.storage
        .from(PARTNER_BUCKET)
        .list("", { limit: 200, sortBy: { column: "name", order: "asc" } });
      if (listErr) {
        console.log(`[Partnered Logos] List error: ${listErr.message}`);
        return c.json({ error: "Failed to list partner logo files", bucket: PARTNER_BUCKET }, 502);
      }

      console.log(`[Partnered Logos] Raw entries: ${JSON.stringify((files || []).map((f: any) => ({ n: f.name, id: !!f.id })))}`);

      // Collect image files from root
      const rootImages = (files || []).filter((f: any) =>
        f.name && !f.name.startsWith(".") && !f.name.endsWith("/") && IMG_RE.test(f.name)
      );

      // Also check subdirectories (folders have no id)
      const folders = (files || []).filter((f: any) => !f.id && f.name && !f.name.startsWith("."));
      const subImages: { name: string; path: string }[] = [];
      for (const folder of folders) {
        const { data: sub } = await supabase.storage
          .from(PARTNER_BUCKET)
          .list(folder.name, { limit: 100 });
        if (sub) {
          for (const sf of sub) {
            if (sf.name && IMG_RE.test(sf.name)) {
              subImages.push({ name: sf.name, path: `${folder.name}/${sf.name}` });
            }
          }
        }
      }

      // Combine: root images + sub-directory images
      const allImages = [
        ...rootImages.map((f: any) => ({ name: f.name, path: f.name })),
        ...subImages,
      ];

      console.log(`[Partnered Logos] Image files (${allImages.length}): [${allImages.map((f: any) => f.path).join(", ")}]`);

      if (allImages.length === 0) {
        return c.json({ logos: [], bucket: PARTNER_BUCKET, rawFileCount: (files || []).length, hint: "No image files found" });
      }

      // Step 3: Build URLs using Supabase client's getPublicUrl (correct encoding)
      if (isPublic) {
        const logos = allImages.map((f: any) => {
          const { data } = supabase.storage.from(PARTNER_BUCKET).getPublicUrl(f.path);
          return { name: f.name, publicUrl: data.publicUrl };
        });
        console.log(`[Partnered Logos] Public — ${logos.length} URL(s) built`);
        return c.json({ logos, bucket: PARTNER_BUCKET, urlType: "public", isPublic: true });
      }

      // Private bucket — create signed URLs
      const { data: signedUrls, error: signErr } = await supabase.storage
        .from(PARTNER_BUCKET)
        .createSignedUrls(
          allImages.map((f: any) => f.path),
          PARTNER_SIGNED_TTL,
        );
      if (signErr) {
        console.log(`[Partnered Logos] Signed URL error: ${signErr.message} — using getPublicUrl fallback`);
        const logos = allImages.map((f: any) => {
          const { data } = supabase.storage.from(PARTNER_BUCKET).getPublicUrl(f.path);
          return { name: f.name, publicUrl: data.publicUrl };
        });
        return c.json({ logos, bucket: PARTNER_BUCKET, urlType: "public-fallback" });
      }

      const logos = (signedUrls || [])
        .filter((s: any) => !s.error)
        .map((s: any) => ({
          name: allImages.find((f: any) => f.path === s.path)?.name || s.path,
          publicUrl: s.signedUrl,
        }));
      console.log(`[Partnered Logos] Signed — ${logos.length} URL(s): [${logos.map((l: any) => l.name).join(", ")}]`);
      return c.json({ logos, bucket: PARTNER_BUCKET, urlType: "signed", isPublic: false });
    } catch (err) {
      console.error(`[Partnered Logos] Unexpected error (${safeErrorClass(err)}):`, err);
      return c.json({ error: "Partner logo service temporarily unavailable" }, 500);
    }
  });

  // Diagnostic endpoint — owner-only raw bucket listing for debugging
  app.get(`${ROUTE_PREFIX}/partnered-logos/debug`, async (c) => {
    const ownerAuth = await requireOwner(c);
    if (ownerAuth instanceof Response) return ownerAuth;
    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL");
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (!supabaseUrl || !serviceKey) return c.json({ error: "Missing env" }, 500);
      const supabase = createSupabaseClient(supabaseUrl, serviceKey);

      const { data: buckets } = await supabase.storage.listBuckets();
      const allBuckets = (buckets || []).map((b: any) => ({ name: b.name, public: !!(b as any).public, id: b.id }));

      const { data: files, error: listErr } = await supabase.storage
        .from(PARTNER_BUCKET)
        .list("", { limit: 200 });

      const rawFiles = (files || []).map((f: any) => ({
        name: f.name,
        id: f.id || null,
        metadata: f.metadata || null,
        isImage: IMG_RE.test(f.name || ""),
      }));

      // Check one level of subfolders
      const folders = (files || []).filter((f: any) => !f.id && f.name && !f.name.startsWith("."));
      const subFiles: any[] = [];
      for (const folder of folders) {
        const { data: sub } = await supabase.storage.from(PARTNER_BUCKET).list(folder.name, { limit: 100 });
        if (sub) {
          for (const sf of sub) {
            subFiles.push({ folder: folder.name, name: sf.name, id: sf.id || null, isImage: IMG_RE.test(sf.name || "") });
          }
        }
      }

      return c.json({ buckets: allBuckets, targetBucket: PARTNER_BUCKET, rootFiles: rawFiles, subFiles, listError: listErr?.message || null });
    } catch (err) {
      console.error(`[Partnered Logos Debug] Unexpected error (${safeErrorClass(err)}):`, err);
      return c.json({ error: "Debug query failed" }, 500);
    }
  });
}