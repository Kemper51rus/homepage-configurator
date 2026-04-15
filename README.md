# Homepage Browser Editor Mod

Separate mod for `gethomepage/homepage` that adds browser-based editing for services, bookmarks, and background images.

The upstream project is treated as a target checkout. This repository owns the mod code, patch, installer script, and release history.

## Install Into A Homepage Checkout

From this mod repository:

```bash
npm run install:target -- --target /opt/homepage
npm run enable:target -- --target /opt/homepage
```

Then restart homepage with the normal environment required by your deployment. For development from another host, include the exact host and port:

```bash
PORT=3001 \
HOMEPAGE_ALLOWED_HOSTS=localhost:3001,127.0.0.1:3001,100.100.0.230:3001 \
HOMEPAGE_ALLOWED_DEV_ORIGINS=100.100.0.230 \
HOMEPAGE_BROWSER_EDITOR=true \
pnpm dev -p 3001
```

## Disable

```bash
npm run disable:target -- --target /opt/homepage
```

This only sets `HOMEPAGE_BROWSER_EDITOR=false` in the target `.env.local`. It does not remove patched files.

## Status

```bash
npm run status:target -- --target /opt/homepage
```

## Patch

The install script applies:

```text
patches/browser-editor.patch
```

The patch adds:

- `src/mods/browser-editor/*`
- thin Next API wrappers under `src/pages/api/config/*`
- small hook points in service/bookmark cards and lists
- `HOMEPAGE_BROWSER_EDITOR` support in `next.config.js`
- target-side helper scripts in `package.json`

## Author

Set the author in `package.json` before publishing this as a real repository.
