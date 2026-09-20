import type {
	CfDnsRecord,
	CfEmailRoutingRule,
	CfResponse,
	CfSendingSubdomain,
} from "@/lib/cloudflare-api.types";
import {
	formatCloudflareError,
	getCloudflareAuth,
	getCloudflareAuthHeaders,
	getCloudflareAuthHint,
	getEmailWorkerName,
} from "@/lib/cloudflare-api-utils";
import { getZoneLookupCandidates } from "@/lib/domains/utils";
export type { CfDnsRecord } from "@/lib/cloudflare-api.types";

export async function cfRequest<T>(
	env: CloudflareEnv,
	path: string,
	init?: RequestInit,
): Promise<T> {
	const auth = getCloudflareAuth(env);
	const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
		...init,
		headers: {
			...getCloudflareAuthHeaders(auth),
			"Content-Type": "application/json",
			...(init?.headers ?? {}),
		},
	});
	const json = (await res.json()) as CfResponse<T>;

	if (!json.success) {
		throw new Error(
			`${formatCloudflareError(path, res.status, res.statusText, json.errors ?? [])}${getCloudflareAuthHint(json.errors ?? [])}`,
		);
	}
	return json.result;
}

export async function findZoneByHostname(
	env: CloudflareEnv,
	hostname: string,
): Promise<{ id: string; name: string } | null> {
	for (const candidate of getZoneLookupCandidates(hostname)) {
		const zones = await cfRequest<{ id: string; name: string }[]>(
			env,
			`/zones?name=${encodeURIComponent(candidate)}&status=active`,
		);
		const zone = zones.find((z) => z.name === candidate);
		if (zone) return zone;
	}

	return null;
}

export async function getEmailRoutingDns(
	env: CloudflareEnv,
	zoneId: string,
): Promise<{ records: CfDnsRecord[]; missing: CfDnsRecord[] }> {
	const result = await cfRequest<{
		record?: CfDnsRecord[];
		errors?: { missing?: CfDnsRecord }[];
	}>(env, `/zones/${zoneId}/email/routing/dns`);
	return {
		records: result.record ?? [],
		missing: (result.errors ?? [])
			.map((e) => e.missing)
			.filter(Boolean) as CfDnsRecord[],
	};
}

export async function enableEmailRouting(
	env: CloudflareEnv,
	zoneId: string,
	hostname?: string,
) {
	return cfRequest<{ status?: string; enabled?: boolean }>(
		env,
		`/zones/${zoneId}/email/routing/dns`,
		{
			method: "POST",
			...(hostname ? { body: JSON.stringify({ name: hostname }) } : {}),
		},
	);
}

export async function disableEmailRouting(env: CloudflareEnv, zoneId: string) {
	return cfRequest<unknown>(env, `/zones/${zoneId}/email/routing/dns`, {
		method: "DELETE",
	});
}

export async function listSendingSubdomains(
	env: CloudflareEnv,
	zoneId: string,
) {
	return cfRequest<CfSendingSubdomain[]>(
		env,
		`/zones/${zoneId}/email/sending/subdomains`,
	);
}

export async function createSendingSubdomain(
	env: CloudflareEnv,
	zoneId: string,
	hostname: string,
) {
	return cfRequest<{ tag: string; name: string; enabled: boolean }>(
		env,
		`/zones/${zoneId}/email/sending/subdomains`,
		{
			method: "POST",
			body: JSON.stringify({ name: hostname }),
		},
	);
}

export async function deleteSendingSubdomain(
	env: CloudflareEnv,
	zoneId: string,
	subdomainTag: string,
) {
	return cfRequest<unknown>(
		env,
		`/zones/${zoneId}/email/sending/subdomains/${subdomainTag}`,
		{ method: "DELETE" },
	);
}

export async function getSendingSubdomainDns(
	env: CloudflareEnv,
	zoneId: string,
	subdomainTag: string,
): Promise<CfDnsRecord[]> {
	return cfRequest<CfDnsRecord[]>(
		env,
		`/zones/${zoneId}/email/sending/subdomains/${subdomainTag}/dns`,
	);
}

export async function getEmailRoutingSettings(
	env: CloudflareEnv,
	zoneId: string,
) {
	return cfRequest<{ enabled?: boolean; status?: string; name?: string }>(
		env,
		`/zones/${zoneId}/email/routing`,
	);
}

export async function listEmailRoutingRules(env: CloudflareEnv, zoneId: string) {
	return cfRequest<CfEmailRoutingRule[]>(
		env,
		`/zones/${zoneId}/email/routing/rules`,
	);
}

export async function deleteEmailRoutingRule(
	env: CloudflareEnv,
	zoneId: string,
	ruleId: string,
) {
	return cfRequest<unknown>(
		env,
		`/zones/${zoneId}/email/routing/rules/${ruleId}`,
		{ method: "DELETE" },
	);
}

export async function createEmailRoutingRuleToWorker(
	env: CloudflareEnv,
	zoneId: string,
	address: string,
) {
	const workerName = getEmailWorkerName();
	return cfRequest<CfEmailRoutingRule>(
		env,
		`/zones/${zoneId}/email/routing/rules`,
		{
			method: "POST",
			body: JSON.stringify({
				actions: [{ type: "worker", value: [workerName] }],
				enabled: true,
				matchers: [{ type: "literal", field: "to", value: address }],
				name: `Route ${address} to ${workerName}`,
			}),
		},
	);
}

function isWorkerRouteForAddress(
	rule: CfEmailRoutingRule,
	normalizedAddress: string,
	workerName: string,
): boolean {
	const routesAddress = rule.matchers?.some(
		(matcher) => matcher.type === "literal" && matcher.field === "to" && matcher.value?.toLowerCase() === normalizedAddress,
	);
	const sendsToWorker = rule.actions?.some(
		(action) => action.type === "worker" && (action.value?.length ? action.value.includes(workerName) : true),
	);
	return Boolean(routesAddress && sendsToWorker);
}

export async function ensureEmailRoutingRuleToWorker(
	env: CloudflareEnv,
	zoneId: string,
	address: string,
) {
	const normalized = address.toLowerCase();
	const workerName = getEmailWorkerName();
	const rules = await listEmailRoutingRules(env, zoneId);

	// A rule may already exist for this exact recipient but point to another
	// destination. Cloudflare rejects a second POST with code 2014
	// (Duplicated Zone rule), so treat the recipient matcher as the unique key
	// and reconcile the existing rule instead of blindly creating another one.
	const existing = rules.find((rule) => isWorkerRouteForAddress(rule, normalized, workerName));
	if (existing?.enabled && existing.id) return existing;

	const existingAddressRule = rules.find((rule) =>
		rule.matchers?.some(
			(matcher) =>
				matcher.type === "literal" &&
				matcher.field === "to" &&
				matcher.value?.toLowerCase() === normalized,
		),
	);

	if (existingAddressRule?.id) {
		return cfRequest<CfEmailRoutingRule>(
			env,
			`/zones/${zoneId}/email/routing/rules/${existingAddressRule.id}`,
			{
					method: "PUT",
					body: JSON.stringify({
						actions: [{ type: "worker", value: [workerName] }],
						enabled: true,
					matchers: [{ type: "literal", field: "to", value: normalized }],
					name: existingAddressRule.name ?? `Route ${normalized} to ${workerName}`,
					priority: existingAddressRule.priority,
				}),
				},
			);
	}

	try {
		return await createEmailRoutingRuleToWorker(env, zoneId, normalized);
	} catch (error) {
		// Handle a race where another request created the same rule between the
		// list and POST calls. Re-read the rules and reconcile the duplicate.
		if (!/code 2014|Duplicated Zone rule/i.test(error instanceof Error ? error.message : String(error))) {
			throw error;
		}

		const refreshedRules = await listEmailRoutingRules(env, zoneId);
		const duplicate = refreshedRules.find((rule) =>
			rule.matchers?.some(
				(matcher) =>
					matcher.type === "literal" &&
					matcher.field === "to" &&
					matcher.value?.toLowerCase() === normalized,
			),
		);

		if (!duplicate?.id) throw error;

		return cfRequest<CfEmailRoutingRule>(
			env,
			`/zones/${zoneId}/email/routing/rules/${duplicate.id}`,
			{
					method: "PUT",
					body: JSON.stringify({
						actions: [{ type: "worker", value: [workerName] }],
						enabled: true,
					matchers: [{ type: "literal", field: "to", value: normalized }],
					name: duplicate.name ?? `Route ${normalized} to ${workerName}`,
					priority: duplicate.priority,
				}),
				},
			);
	}
}

export async function deleteEmailRoutingRuleForAddress(
	env: CloudflareEnv,
	zoneId: string,
	address: string,
): Promise<boolean> {
	const normalized = address.toLowerCase();
	const workerName = getEmailWorkerName();
	const rules = await listEmailRoutingRules(env, zoneId);
	const existing = rules.find((rule) => isWorkerRouteForAddress(rule, normalized, workerName));
	if (!existing?.id) return false;
	await deleteEmailRoutingRule(env, zoneId, existing.id);
	return true;
}
