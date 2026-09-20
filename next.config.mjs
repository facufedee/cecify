/** @type {import('next').NextConfig} */
const nextConfig = {
  // PGlite (base local de desarrollo) carga archivos wasm en runtime: no bundlear
  serverExternalPackages: ['@electric-sql/pglite'],
};

export default nextConfig;
