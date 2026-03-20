# EvEJS Script Guide

This file explains what the main scripts are for and when you would use them.

If you are brand new, read `../docs/SETUP.md` first. Come back here when you want to understand which launcher or helper script fits a specific task.

## The Three Scripts Most People Need

If you only remember three things, remember these:

- `scripts\windows\EvEJSConfig.bat`
  Edit this once so the repo knows where your EVE client copy lives.
- `scripts\windows\InstallCerts.bat`
  Run this after you set the client path.
- `scripts\windows\StartServerOnly.bat`
  Use this to start the server for normal day-to-day testing.

Then launch the client with:

- `scripts\windows\StartClientOnly.bat`

## Windows Launcher Scripts

### Config

- `scripts\windows\EvEJSConfig.bat`
  Your local launcher settings live here.

What it controls:

- where the client copy is
- whether you want to point directly at a specific `exefile.exe`
- what local proxy URL the client should use
- which CA certificate file should be trusted for local TLS

### Certificate setup

- `scripts\windows\InstallCerts.bat`
  Beginner-friendly wrapper around the PowerShell certificate installer.

Use it when:

- this is your first setup
- you changed `EVEJS_CLIENT_PATH`
- you replaced or repaired the client copy

It helps by:

- trusting the local CA in your current Windows user store
- appending that CA to the client certificate bundles

### Server launchers

- `scripts\windows\StartServerOnly.bat`
  Starts the main server with the normal local intercept path enabled.

Best for:

- everyday testing
- first-time setup checks
- simple one-server-one-client sessions

- `scripts\windows\StartServerNoProxy.bat`
  Starts the server but leaves the proxy to a separate launcher.

Best for:

- proxy debugging
- keeping server and proxy output in different windows

### Proxy launcher

- `scripts\windows\StartClientProxyOnly.bat`
  Runs just the local proxy process.

Best for:

- pairing with `StartServerNoProxy.bat`
- isolating proxy output while debugging

### Client launchers

- `scripts\windows\StartClientOnly.bat`
  The simplest normal client launcher. No debug console.

Best for:

- everyday use
- first login tests
- situations where you do not want extra console noise

- `scripts\windows\RunClientProxy.bat`
  Starts the client with the local proxy and TLS environment variables wired in.

Best for:

- explicit proxy-aware startup
- verifying the proxy environment

- `scripts\windows\RunClientProxyAndDebug.bat`
  Same as `RunClientProxy.bat`, but enables the EVE debug console.

Best for:

- client-side debugging
- checking launch-time errors
- deeper troubleshooting sessions

- `scripts\windows\RunClientNoDebug.bat`
  Internal helper used by `StartClientOnly.bat`.

- `scripts\windows\RunProxyOnly.bat`
  Internal helper used by `StartClientProxyOnly.bat`.

## Recommended Launch Combinations

### Easiest everyday setup

1. `scripts\windows\StartServerOnly.bat`
2. `scripts\windows\StartClientOnly.bat`

### Proxy in a separate window

1. `scripts\windows\StartServerNoProxy.bat`
2. `scripts\windows\StartClientProxyOnly.bat`
3. `scripts\windows\StartClientOnly.bat`

### Debug session

1. `scripts\windows\StartServerNoProxy.bat`
2. `scripts\windows\StartClientProxyOnly.bat`
3. `scripts\windows\RunClientProxyAndDebug.bat`

## Root npm Scripts

These are useful if you prefer PowerShell over clicking batch files.

- `npm run install:certs`
  Runs `scripts\Install-EvEJSCerts.ps1`.

- `npm run start:server`
  Starts the Node server in `server/`.

- `npm run sync:static-data`
  Merges JSONL static-data inputs and exports asteroid belt data.

- `npm run sync:cosmetics-data`
  Merges local cosmetics data into the repo-local output.

- `npm run verify:static-data`
  Verifies local static-data inputs against expected output.

- `npm run cleanup:invalid-fits`
  Repairs or removes invalid fit data.

- `npm run scrape:eve-survival-missions`
  Downloads mission archive data into the local `data/` workspace.

- `npm run parse:eve-survival-missions`
  Parses the scraped mission archive data into a more structured form.

- `npm run sync:reference-data`
  Runs the main reference-data refresh flow.

- `npm run zip:source`
  Builds a clean source zip and skips local-only files.

## Advanced Script Areas

### `scripts\dev\`

This folder is mostly for contributors working on:

- static-data imports
- cosmetics/reference-data sync
- mission-data scraping
- data cleanup jobs

If you are just trying to boot the server and log in, you can safely ignore this folder for now.

### `scripts\internal\`

This folder is mostly for:

- self-tests
- parity checks
- maintenance scripts
- benchmarks
- cert-building helpers

Use these when you are validating a specific subsystem or following a contributor workflow.

## Utility Scripts

- `scripts\New-SourceZip.ps1`
  Creates a shareable source archive without bundling clients, logs, or scratch data.

- `scripts\SimulateCpuLoad.bat`
  Starts a temporary CPU load test for roughly 40 seconds.

- `scripts\SimulateCpuLoad.js`
  The Node script behind the CPU load helper.

- `scripts\windows\OpenEveSurvivalMissionScrapeWindow.bat`
  Opens a dedicated terminal window for the mission scraper.

- `scripts\windows\RunEveSurvivalMissionScrape.bat`
  Runs the EVE-Survival mission scrape from a Windows terminal with status output.

## Common Questions

### Which script should I double-click first?

`scripts\windows\StartServerOnly.bat`

Then:

`scripts\windows\StartClientOnly.bat`

### Which script should I edit first?

`scripts\windows\EvEJSConfig.bat`

### Which script fixes certificate errors?

`scripts\windows\InstallCerts.bat`

### Which script should I use when I need the debug console?

`scripts\windows\RunClientProxyAndDebug.bat`

### Which script builds a clean zip for sharing?

`npm run zip:source`

or:

`scripts\New-SourceZip.ps1`
