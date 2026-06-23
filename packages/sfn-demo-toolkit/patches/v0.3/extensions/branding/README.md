# Branding Extension

Multi-client branding for Storefront Next demos. Switch active client via env var:

```bash
PUBLIC__app__branding__activeClient=<clientId>
```

## Adding a new client

1. Create `clients/<clientId>/content.ts` exporting a `BrandContent` object
2. Create `clients/<clientId>/theme.css` with `:root[data-brand='<clientId>']` token overrides
3. Drop assets in `clients/<clientId>/public/` (logos, hero images)
4. Register the client in `registry.ts`
5. Add `.env.profiles/<clientId>.env` with `PUBLIC__app__branding__activeClient=<clientId>` and any commerce overrides

## Switching client in dev

```bash
pnpm demo:switch <clientId>
```
