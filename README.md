# Duplicate Finder Studio

Windows duplicate finder with:

- CLI mode for direct automation
- Electron desktop UI for safer daily use
- content-based duplicate detection
- ZIP-aware comparison
- safe move workflow with dry-run support

The app never deletes files. It only moves duplicates.

## What It Does

- Recursively scans one or more folders or drives
- Groups files by size first, then hashes only real candidates
- Keeps one original file for normal duplicate groups
- Moves duplicate ZIP groups into dedicated `zip/group-xxx` folders
- Can compare ZIP archives by archive contents
- Can compare files inside ZIP archives with matching unzipped files on disk
- Can collect empty folders after moves
- Supports a folder-only mode for gathering empty directories

## Project Structure

```text
/project
  app.js
  engine.js
  collector.js
  scanner.js
  hasher.js
  mover.js
  utils.js
  package.json
  /electron
    main.js
    preload.js
  /renderer
    index.html
    renderer.js
    styles.css
  /assets
    icon.svg
  /build
    icon.ico
    icon.png
  /scripts
    generate-icons.js
```

## Requirements

- Windows
- Node.js 18+ recommended

## Install

```powershell
npm install
```

## CLI Usage

Basic example:

```powershell
node app.js --paths "D:\,E:\" --output "D:\DUPLICATES"
```

Dry run:

```powershell
node app.js --paths "D:\,E:\" --output "D:\DUPLICATES" --dry-run
```

ZIP content mode:

```powershell
node app.js --paths "D:\,E:\" --output "D:\DUPLICATES" --zip-mode contents
```

Collect empty folders after moves:

```powershell
node app.js --paths "D:\,E:\" --output "D:\DUPLICATES" --collect-empty-dirs
```

Empty folder only mode:

```powershell
node app.js --paths "D:\,E:\" --output "D:\DUPLICATES" --empty-dir-only
```

Exclude folders:

```powershell
node app.js --paths "D:\" --output "D:\DUPLICATES" --exclude "D:\OLD_DUPLICATES,D:\Archive\DoNotScan"
```

## CLI Arguments

- `--paths`
  Comma-separated directories or drives to scan

- `--output`
  Destination folder for moved duplicates

- `--dry-run`
  Preview actions without moving files

- `--concurrency`
  Maximum concurrent hashing streams
  Default: `4`

- `--zip-mode`
  ZIP duplicate strategy:
  - `file`
  - `contents`
  Default: `file`

- `--exclude`
  Comma-separated folders to skip

- `--collect-empty-dirs`
  Collect empty folders after file moves

- `--empty-dir-only`
  Only collect empty folders without scanning files

- `--help`
  Show help

## Duplicate Rules

### Normal Files

- One original is kept
- Remaining duplicates are moved

Categories:

- Images: `jpg`, `jpeg`, `png`, `gif`, `webp`
- Videos: `mp4`, `mkv`, `avi`, `mov`
- Documents: `pdf`, `docx`, `xlsx`, `txt`
- Others: everything else

### ZIP Files

`--zip-mode file`

- compares raw `.zip` bytes
- ZIPs only match when the archive files themselves are identical

`--zip-mode contents`

- reads ZIP central directory metadata without extracting files permanently
- supports standard ZIP and ZIP64 metadata
- groups ZIPs when their archive contents match
- groups ZIPs when they share duplicate internal files
- checks duplicate internal names inside each ZIP and logs warnings
- compares ZIP entries to normal files on disk
- uses `filename + size + CRC32` as a fast filter
- verifies ZIP entry content vs normal file content with MD5 before grouping

ZIP move behavior:

- matching ZIP groups are moved into dedicated folders like:

```text
OUTPUT/zip/group-001/
OUTPUT/zip/group-002/
```

## Output Layout

Example:

```text
D:\DUPLICATES
  documents
  empty-folders
  images
  others
  videos
  zip
    group-001
    group-002
  duplicate-finder.log
```

If `--collect-empty-dirs` is enabled:

```text
OUTPUT\empty-folders\<source-root-label>\...
```

## Safety Notes

- Files are moved, never deleted
- Output folder is created automatically
- Filename conflicts are auto-renamed with ` (1)`, ` (2)`, and so on
- System folders such as `Windows`, `Program Files`, and `AppData` are skipped
- Folders named like `DUPLICATES`, `DUPLICATES_OLD`, or `DUPLICATES-2026` are skipped automatically
- `--exclude` gives you explicit skip control
- Empty folder collection never removes the scan root itself

## Electron Desktop App

Run the desktop app:

```powershell
npm start
```

Desktop workflow:

- Add scan folders
- Add optional excluded folders
- Choose output folder
- Select ZIP mode
- Enable dry run first if needed
- Start scan

The Electron app uses the same scan engine as the CLI.

## Electron Security

The desktop app is hardened with:

- `contextIsolation: true`
- `sandbox: true`
- `nodeIntegration: false`
- blocked navigation and blocked popup windows
- main-process approved directory tokens instead of trusting raw renderer paths

## App Icon

Source vector:

- [assets/icon.svg](c:/_Data/_Personal_Project/PersonalProject/codex/duplicateFinder/assets/icon.svg)

Generated runtime/build icons:

- [build/icon.png](c:/_Data/_Personal_Project/PersonalProject/codex/duplicateFinder/build/icon.png)
- [build/icon.ico](c:/_Data/_Personal_Project/PersonalProject/codex/duplicateFinder/build/icon.ico)

Regenerate icons:

```powershell
npm run generate:icons
```

## Build Windows `.exe`

Generate unpacked app folder:

```powershell
npm run pack
```

Generate Windows installer:

```powershell
npm run dist
```

Build output:

```text
release/
```

Note:

- the project is configured for Windows build output
- on some Windows setups, `electron-builder` may require Administrator privileges or Developer Mode because of symlink/signing helper extraction

## Logs

The tool writes logs inside the output folder:

- `duplicate-finder.log`
- `duplicate-finder-dry-run.log`

Logs include:

- scan start info
- skipped paths
- ZIP duplicate analysis notes
- move actions
- dry-run actions

## Recommended First Run

```powershell
node app.js --paths "D:\,E:\" --output "D:\DUPLICATES" --dry-run --zip-mode contents
```

Or from the desktop UI:

```powershell
npm start
```
