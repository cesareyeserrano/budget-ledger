/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // El gate de smoke corre EN PARALELO con la suite e2e dentro de `aitri verify-run`, y el webServer
  // de Playwright reescribe `.next` con su propio `next build`. Compartir el directorio hacía que uno
  // le arrancara el build al otro por debajo: corridas colgadas y "Could not find a production build".
  // Con NEXT_DIST_DIR el smoke compila y sirve desde su propio directorio, aislado.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Security headers (NFR-004). Nginx puede añadir/duplicar TLS y otros en producción.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "no-referrer" },
        ],
      },
    ];
  },
};

export default nextConfig;
