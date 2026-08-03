import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@kritt-radar/db', '@kritt-radar/pipeline'],
};

export default nextConfig;
