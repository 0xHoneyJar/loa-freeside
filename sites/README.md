# Sites

Web properties for the Freeside platform.

## Structure

| Directory | Description | Framework | Deployment |
|-----------|-------------|-----------|------------|
| `docs/` | Documentation site | Nextra (Next.js) | Vercel |
| `web/` | Marketing website | Next.js | Vercel |

## Adding a New Site

1. Create a new directory under `sites/`
2. Initialize with your framework of choice
3. Add deployment configuration
4. Update this README

## Local Development

```bash
# Documentation site
cd sites/docs && npm install && npm run dev

# Marketing website
cd sites/web && npm install && npm run dev
```
