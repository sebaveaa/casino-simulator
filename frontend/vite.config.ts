import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  server: {
    // Node resolves "localhost" to ::1 first, so the default bind is IPv6 only and a browser
    // that connects over IPv4 gets "connection refused". Bind IPv4 loopback explicitly.
    host: "127.0.0.1",
  },
  test: {
    environment: "jsdom",
  },
});
