// craco.config.js
const path = require("path");

module.exports = {
  eslint: {
    configure: {
      extends: ["plugin:react-hooks/recommended"],
      rules: {
        "react-hooks/rules-of-hooks": "error",
        "react-hooks/exhaustive-deps": "warn",
      },
    },
  },
  webpack: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
    configure: (webpackConfig) => {
      webpackConfig.watchOptions = {
        ...webpackConfig.watchOptions,
        ignored: ["**/node_modules/**", "**/.git/**", "**/build/**", "**/coverage/**"],
      };
      return webpackConfig;
    },
  },
  devServer: (devServerConfig) => {
    // В режиме разработки /api проксируется на локальный бэкенд
    devServerConfig.proxy = {
      "/api": { target: process.env.DEV_BACKEND_URL || "http://localhost:8000", changeOrigin: true },
    };
    return devServerConfig;
  },
};
