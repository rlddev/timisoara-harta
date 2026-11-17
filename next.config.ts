import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // în C:\Users\<user> există un package-lock.json rătăcit; rădăcina e proiectul
  turbopack: { root: path.resolve(__dirname) },
};

export default nextConfig;
