import type { NextConfig } from "next";

const isGitHubPages = process.env.GITHUB_PAGES === "true";

const nextConfig: NextConfig = {
  output: "export",
  basePath: isGitHubPages ? "/LR-Pendientes-Check-List" : undefined,
  trailingSlash: true,
};

export default nextConfig;
