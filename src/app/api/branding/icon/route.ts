import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { appSettings } from "@/db/schema";
import { APP_SETTINGS_ID } from "@/lib/branding/service";
import { getEnvAsync } from "@/lib/cloudflare";
import { getLicenseEntitlements } from "@/lib/licenses/service";
import { getBlob } from "@/lib/storage/blob";

export const dynamic = "force-dynamic";
export const revalidate = 0;

async function getDefaultIcon(env: CloudflareEnv): Promise<Response> {
	const asset = await env.ASSETS.fetch("https://mailflare.local/icon-96.png");

	return new Response(await asset.arrayBuffer(), {
		status: asset.status,
		statusText: asset.statusText,
		headers: asset.headers,
	});
}

export async function GET(request: Request) {
	void request;

	const env = await getEnvAsync();

	if (!(await getLicenseEntitlements(env)).canCustomizeBranding) {
		return getDefaultIcon(env);
	}

	try {
		const [settings] = await getDb(env)
			.select({ iconKey: appSettings.iconKey })
			.from(appSettings)
			.where(eq(appSettings.id, APP_SETTINGS_ID))
			.limit(1);

		if (settings?.iconKey) {
			const blob = await getBlob(env, settings.iconKey);

			if (blob) {
				return new Response(blob.data, {
					headers: {
						"Content-Type": blob.contentType ?? "image/png",
						"Cache-Control": "no-cache",
						"X-Content-Type-Options": "nosniff",
					},
				});
			}
		}
	} catch {
		// Use the packaged icon if the custom branding blob is unavailable.
	}

	return getDefaultIcon(env);
}
