/** @type {import('next').NextConfig} */
const API_TARGET = process.env.API_TARGET || "http://localhost:8080";

const nextConfig = {
  reactStrictMode: true,
  // Self-contained server build for the Docker image (.next/standalone).
  output: "standalone",
  // Proxy /api/* to the Go backend so the browser talks same-origin (dev: localhost:8080, docker: http://api:8080).
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_TARGET}/api/:path*` }];
  },
};

export default nextConfig;
