import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import staticAssetsIncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/static-assets-incremental-cache";

export default defineCloudflareConfig({
  // Keep build-time/static routes in Workers Static Assets so the Worker
  // does less work on the Workers Free plan's 10 ms CPU budget.
  incrementalCache: staticAssetsIncrementalCache,
  enableCacheInterception: true,
});
