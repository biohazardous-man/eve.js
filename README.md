# EvEJS Elysian

> [!WARNING]
> This project is still a work in progress. Some parts work well, and some parts are still being built.

This project lets you run EVE against a local server on your own computer.

If you are not technical, that is okay. Follow the steps below slowly, one by one.

## Before You Start

You need:

- a Windows PC
- Node.js installed
- this project on your computer
- a separate copy of your EVE game folder

Important:

- do not use your normal everyday EVE folder
- make a copy of EVE just for this project

## The Easy Install

### 1. Install Node.js

Install Node.js.

If the website asks which version you want, choose `LTS`.

If you already have Node.js installed, you can skip this.

### 2. Open This Folder In Terminal

Open this project folder on your computer.

Then open a terminal window inside it:

- Windows 11: right-click inside the folder and choose `Open in Terminal`
- Windows 10: open PowerShell and go to this folder

### 3. Paste These Two Commands

Paste these one at a time:

```powershell
npm ci
npm --prefix server ci
```

Wait for both to finish.

### 4. Put Your EVE Copy In The Simple Location

The easiest option is to put your EVE copy here:

```text
client\EVE\tq
```

If you do that, you usually do not need to change anything else.

If your EVE copy is somewhere else, open `scripts\windows\EvEJSConfig.bat` and change the client path there.

### 5. Patch Your EVE Copy

You need to do this once for your copied EVE folder.

1. Open the `PATCHED_FILES` folder in this project.
2. Copy `blue.dll`.
3. Open your copied EVE folder.
4. Open its `bin64` folder.
5. Paste `blue.dll` there and replace the old one.
6. Go back to the main EVE folder.
7. Open `start.ini`.
8. Change `CryptoAPI` to `Placebo`.
9. Make sure the server address points to `127.0.0.1:26000`.
10. Save the file.

Small note:

- `127.0.0.1` just means "this computer"

### 6. Run The Trust Step

Double-click:

```text
scripts\windows\InstallCerts.bat
```

This project already includes the main trust files you need.

That script does the rest for you so Windows and the game trust the local connection.

### 7. Start The Server

Double-click:

```text
scripts\windows\StartServerOnly.bat
```

Leave that window open.

### 8. Start The Game

Double-click:

```text
scripts\windows\StartClientOnly.bat
```

## What The Main Files Do

- `scripts\windows\InstallCerts.bat`
  Sets up the local trust step for you.
- `scripts\windows\StartServerOnly.bat`
  Starts the EvEJS server.
- `scripts\windows\StartClientOnly.bat`
  Starts your copied EVE client.
- `scripts\windows\RunClientProxyAndDebug.bat`
  Starts the client with an extra debug window. Only use this if you are trying to troubleshoot something.

## If It Does Not Work

Check these first:

- Did `npm ci` finish without errors?
- Did `npm --prefix server ci` finish without errors?
- Did you use a copied EVE folder, not your normal live one?
- Did you copy `PATCHED_FILES\blue.dll` into the EVE `bin64` folder?
- Did you change `CryptoAPI` to `Placebo` in `start.ini`?
- Did you set the server address to `127.0.0.1:26000`?
- Did you run `scripts\windows\InstallCerts.bat`?
- Is the server window still open before you start the game?

## If Your EVE Folder Is Somewhere Else

Open:

```text
scripts\windows\EvEJSConfig.bat
```

Find the line that starts with:

```bat
set "EVEJS_CLIENT_PATH=
```

Replace that path with the location of your copied EVE folder.

## Want The Same Steps With More Hand-Holding?

Open [docs/SETUP.md](docs/SETUP.md).
