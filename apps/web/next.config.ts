import type { NextConfig } from 'next';
import { resolve } from 'node:path';

const nextConfig: NextConfig = {
  transpilePackages: ['@kritt-radar/db', '@kritt-radar/pipeline'],
  turbopack: {
    root: resolve(import.meta.dirname, '../..'),
  },
};

export default nextConfig;
