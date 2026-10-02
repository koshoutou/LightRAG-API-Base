import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // 显式指定 Turbopack workspace root 为进程当前目录（项目根），
  // 避免被父级 bun.lock 误判根目录导致 tw-animate-css 解析越界 panic
  turbopack: {
    root: process.cwd(),
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
