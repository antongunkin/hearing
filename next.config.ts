import type { NextConfig } from "next";

// Without the site URL, canonicals, JSON-LD URLs and the sitemap are left out without a word: a production
// deploy must not go out like that.
if (process.env.VERCEL_ENV === "production" && !process.env.NEXT_PUBLIC_SITE_URL?.trim()) {
  throw new Error("NEXT_PUBLIC_SITE_URL is not set: set it in the Vercel project before a production build");
}

const nextConfig: NextConfig = {
  /* config options here */
};

export default nextConfig;
