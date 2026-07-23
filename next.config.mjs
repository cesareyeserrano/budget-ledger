/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // No exponer el framework en el header X-Powered-By (RQ-SEC-002: reduce fingerprinting).
  poweredByHeader: false,
  // El gate de smoke corre EN PARALELO con la suite e2e dentro de `aitri verify-run`, y el webServer
  // de Playwright reescribe `.next` con su propio `next build`. Compartir el directorio hacía que uno
  // le arrancara el build al otro por debajo: corridas colgadas y "Could not find a production build".
  // Con NEXT_DIST_DIR el smoke compila y sirve desde su propio directorio, aislado.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Security headers (NFR-004 raíz + NFR-512 backend). Nginx puede añadir/duplicar TLS en producción.
  // CSP con 'unsafe-inline' en script/style: Next inyecta scripts/estilos inline sin nonce en este
  // setup; una CSP más estricta rompería la app (regresión). frame-ancestors 'none' + base-uri 'self'
  // cierran clickjacking e inyección de <base>. El smoke gate verifica que la app arranca con estos.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "no-referrer" },
          // HSTS (NFR-512): el navegador fuerza HTTPS. Efectivo tras el primer acceso sobre TLS.
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
          {
            key: "Content-Security-Policy",
            value:
              "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'self'; frame-ancestors 'none'",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
