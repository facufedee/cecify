// Headers de seguridad para todas las respuestas. La sesion vive en localStorage, asi que lo que mas
// importa es que otra pagina no pueda meter la app en un iframe (clickjacking) ni que el navegador
// adivine tipos de archivo (una "foto" interpretada como HTML).
const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'" },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Las fotos se eligen con <input type="file">: no hace falta pedir camara, microfono ni ubicacion
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
]

/** @type {import('next').NextConfig} */
const nextConfig = {
  // PGlite (base local de desarrollo) carga archivos wasm en runtime: no bundlear
  serverExternalPackages: ['@electric-sql/pglite'],
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }]
  },
};

export default nextConfig;
