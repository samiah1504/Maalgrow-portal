import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  headers: async () => [
    {
      source: "/(.*)",
      headers: [
        { key: "X-Frame-Options", value: "DENY" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        {
          key: "Permissions-Policy",
          value: "camera=(), microphone=(), geolocation=()",
        },
        {
          key: "Strict-Transport-Security",
          value: "max-age=31536000; includeSubDomains; preload",
        },
      ],
    },
    {
      source: "/sw.js",
      headers: [
        { key: "Content-Type", value: "application/javascript; charset=utf-8" },
        { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
      ],
    },
  ],
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "*.supabase.co" },
    ],
  },
  experimental: {
    optimizePackageImports: ["lucide-react", "recharts"],
  },

  /**
   * Ship Chromium with the routes that render PDFs.
   *
   * THE FAILURE THIS FIXES, VERBATIM: 'The input directory
   * "/var/task/node_modules/@sparticuz/chromium/bin" does not exist.'
   *
   * @sparticuz/chromium is already on Next's automatic
   * serverExternalPackages list, so the module itself resolves fine at
   * runtime. What does not arrive is its bin/ directory — 67MB of
   * brotli archives that the package unpacks on first launch. Nothing
   * in the code imports those files; the path is computed at runtime,
   * so file tracing has no way to know they are needed and leaves them
   * behind. The function then boots, finds no browser to unpack, and
   * every statement fails to build.
   *
   * Only the three routes that actually render a PDF. A blanket '/*'
   * would staple 67MB onto every function in the deployment and push
   * the whole thing towards the platform's unzipped size limit for no
   * benefit — none of the others has ever launched a browser.
   *
   * The brackets are escaped because the keys are picomatch globs, so
   * an unescaped [id] would be read as a character class and match
   * nothing.
   */
  outputFileTracingIncludes: {
    "/api/admin/mudarabah/\\[id\\]/statements": [
      "./node_modules/@sparticuz/chromium/bin/**/*",
    ],
    "/api/admin/mudarabah/\\[id\\]/settle": [
      "./node_modules/@sparticuz/chromium/bin/**/*",
    ],
    "/api/admin/wht": ["./node_modules/@sparticuz/chromium/bin/**/*"],
  },
};

export default nextConfig;
