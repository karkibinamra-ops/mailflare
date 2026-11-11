import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [
	{
		ignores: [
			".next/**",
			".open-next/**",
			"node_modules/**",
			"drizzle/**",
			"cloudflare-env.d.ts",
			"next-env.d.ts",
		],
	},
	...nextCoreWebVitals,
	...nextTypescript,
	{
		rules: {
			// Existing UI synchronization effects are intentional; keep these visible as warnings.
			"react-hooks/set-state-in-effect": "warn",
		},
	},
];

export default eslintConfig;
