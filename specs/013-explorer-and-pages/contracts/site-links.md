# Contract: `public/site-links.json`

Written by `amplify.yml` at build time from Amplify variables set by `infra/src/web-stack.ts` (CDK context, empty by default).

```json
{ "crmUrl": "", "demoVideoUrl": "", "prUrl": "" }
```

Each value is `""` (hidden) or an `https://` URL. The Hub validates with Zod; invalid = hidden. `crmUrl` set → the CRM card becomes a live link; unset → "Coming soon · Not deployed yet" with a disabled button.
