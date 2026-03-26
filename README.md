# Duplicate Finder CLI

A production-ready Node.js CLI tool for Windows that scans one or more directories, detects duplicate files by content, and safely moves duplicates into organized folders.

The tool is designed to be careful with real user data:

- It never deletes files
- It moves duplicates instead
- It keeps one original file for normal duplicate groups
- It handles duplicate ZIP files separately
- It logs all actions
- It supports a dry-run preview mode

## Features

- Recursive scanning across one or more folders or drives
- Duplicate detection using a two-step pipeline:
  - Group by file size
  - Hash only same-size files with streaming MD5
- Safe file moving with automatic filename conflict handling
- File categorization into:
  - `images`
  - `videos`
  - `documents`
  - `others`
  - `zip`
- Skips common Windows system folders such as:
  - `Windows`
  - `Program Files`
  - `Program Files (x86)`
  - `AppData`
- Graceful handling of permission errors
- Console summary with:
  - total files scanned
  - duplicate groups found
  - duplicate files found
  - total size that could be saved

## Project Structure

```text
/project
  app.js
  collector.js
  scanner.js
  hasher.js
  mover.js
  utils.js
```

## Requirements

- Windows
- Node.js 18+ recommended

## Run

From this project folder:

```powershell
node app.js --paths "D:\,E:\" --output "D:\DUPLICATES"
```

## CLI Arguments

- `--paths`
  Comma-separated directories or drives to scan

- `--output`
  Destination folder where duplicate files will be moved

- `--dry-run`
  Preview actions without moving any files

- `--concurrency`
  Maximum number of concurrent hashing streams
  Default: `4`

- `--zip-mode`
  ZIP duplicate strategy:
  - `file` = compare ZIP files by the ZIP file bytes
  - `contents` = inspect ZIP archive contents and compare entries inside the archive
  Default: `file`

- `--exclude`
  Comma-separated folders to skip during scanning

- `--collect-empty-dirs`
  After duplicate moves, collect empty directories into `OUTPUT\empty-folders`

- `--empty-dir-only`
  Collect already-empty folders only, without scanning files for duplicates

- `--help`
  Show usage help

## Sample Commands

### 1. Scan a Single Folder

```powershell
node app.js --paths "D:\Photos" --output "D:\DUPLICATES"
```

### 2. Scan a Single Drive

```powershell
node app.js --paths "D:\" --output "D:\DUPLICATES"
```

### 3. Scan Multiple Folders

```powershell
node app.js --paths "D:\Photos,D:\Videos,D:\Documents" --output "D:\DUPLICATES"
```

### 4. Scan Multiple Drives

```powershell
node app.js --paths "D:\,E:\" --output "D:\DUPLICATES"
```

### 5. Scan Internal + External Drive Together

```powershell
node app.js --paths "D:\,F:\" --output "D:\DUPLICATES"
```

### 6. Dry Run Preview

```powershell
node app.js --paths "D:\,E:\" --output "D:\DUPLICATES" --dry-run
```

### 7. Lower Concurrency for Large or Slow Drives

```powershell
node app.js --paths "D:\,E:\" --output "D:\DUPLICATES" --concurrency 2
```

### 8. Compare ZIP Files by Archive Contents

```powershell
node app.js --paths "D:\,E:\" --output "D:\DUPLICATES" --zip-mode contents
```

### 9. Exclude Specific Folders

```powershell
node app.js --paths "D:\,E:\" --output "D:\DUPLICATES" --exclude "D:\OLD_DUPLICATES,E:\Archive\DoNotScan"
```

### 10. Collect Empty Folders After Moving Duplicates

```powershell
node app.js --paths "D:\,E:\" --output "D:\DUPLICATES" --collect-empty-dirs
```

### 11. Preview Empty Folder Collection Too

```powershell
node app.js --paths "D:\,E:\" --output "D:\DUPLICATES" --dry-run --collect-empty-dirs
```

### 12. Collect Empty Folders Only Without File Scanning

```powershell
node app.js --paths "D:\,E:\" --output "D:\DUPLICATES" --empty-dir-only
```

### 13. Preview Empty-Folder-Only Mode

```powershell
node app.js --paths "D:\,E:\" --output "D:\DUPLICATES" --dry-run --empty-dir-only
```

## How Duplicate Detection Works

The tool uses a memory-safe workflow:

1. Recursively scan files from all provided paths
2. Skip known system folders
3. Group files by file size
4. For files with the same size, compute MD5 hashes using `fs.createReadStream`
5. Group matching hashes together
6. Treat any group with more than one file as duplicates

This avoids hashing every file unnecessarily and helps reduce load on large drives.

## File Handling Rules

### Normal Files

For duplicate groups of non-ZIP files:

- The first discovered file is kept as the original
- The remaining duplicates are moved

Destination categories:

- Images: `jpg`, `jpeg`, `png`, `gif`, `webp`
- Videos: `mp4`, `mkv`, `avi`, `mov`
- Documents: `pdf`, `docx`, `xlsx`, `txt`
- Others: everything else

### ZIP Files

The tool supports two ZIP comparison modes.

Default mode:

- `--zip-mode file`
- compares ZIP files as normal files
- two ZIPs match only when the archive bytes are identical

Content-aware mode:

- `--zip-mode contents`
- reads ZIP central directory metadata without extracting files permanently
- compares archive entries by internal path, uncompressed size, and CRC32
- can detect duplicate ZIP archives even when the `.zip` files themselves differ byte-for-byte
- groups ZIP files together when they share duplicate internal files (same filename + size + CRC32)
- compares files inside ZIP archives with unzipped files on disk by using filename, size, and CRC32 as a filter, then verifies content with MD5 before grouping
- logs warnings when a ZIP contains duplicate internal entry names

For duplicate `.zip` groups:

- The tool does not extract ZIP files
- Each matching ZIP duplicate group is moved into its own folder under `OUTPUT/zip/`:

```text
OUTPUT/zip/group-001/
OUTPUT/zip/group-002/
```

## Output Folder Layout

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

When `--collect-empty-dirs` is enabled, empty folders are gathered under:

```text
OUTPUT\empty-folders\<source-root-label>\...
```

Example:

```text
D:\DUPLICATES\empty-folders\D\Photos\Old Album
```

## Safety Behavior

- Files are moved, never deleted
- If the destination already contains the same filename, the tool renames it:
  - `photo.jpg`
  - `photo (1).jpg`
  - `photo (2).jpg`
- Cross-drive moves are handled safely
- Permission failures are skipped and logged
- The current output folder is skipped during scanning
- Folders named like `DUPLICATES`, `DUPLICATES_OLD`, or `DUPLICATES-2026` are skipped automatically to make reruns safer
- You can add your own skip list with `--exclude`
- Empty folder collection is optional and never removes the scan root itself
- `--empty-dir-only` skips duplicate-file scanning entirely and only gathers folders that are already empty

## Logs

The tool writes a log file inside the output folder:

- Normal run: `duplicate-finder.log`
- Dry run: `duplicate-finder-dry-run.log`

The log includes:

- scan start info
- skipped directories
- skipped files
- kept originals
- moved files
- dry-run preview actions

## Recommended Usage

Start with a dry run first:

```powershell
node app.js --paths "D:\,E:\" --output "D:\DUPLICATES" --dry-run
```

If you want ZIP archives compared by what is inside them instead of by raw ZIP file bytes, use:

```powershell
node app.js --paths "D:\,E:\" --output "D:\DUPLICATES" --dry-run --zip-mode contents
```

Review the console output and log file, then run without `--dry-run` when you are confident in the results.

For repeated scans, you can also protect prior result folders explicitly:

```powershell
node app.js --paths "D:\,E:\" --output "D:\DUPLICATES" --dry-run --exclude "D:\OLD_DUPLICATES,E:\PREVIOUS_RESULTS"
```

If you also want to gather folders left empty after moving duplicates:

```powershell
node app.js --paths "D:\,E:\" --output "D:\DUPLICATES" --dry-run --collect-empty-dirs
```

## Notes

- The tool currently uses MD5 because it is fast and suitable for duplicate matching workflows
- In `--zip-mode contents`, both standard ZIP and ZIP64 central directory metadata are supported
- The output folder should not be inside a heavily scanned location unless that is intentional
- Very large scans can take time depending on drive speed, file count, and hash concurrency

## Example Real-World Path Sets

### Personal Media Folders

```powershell
node app.js --paths "D:\Photos,D:\Camera Uploads,D:\Downloads" --output "D:\DUPLICATES"
```

### Internal Drive + External HDD

```powershell
node app.js --paths "D:\,G:\" --output "D:\DUPLICATES"
```

### Specific Backup Folders

```powershell
node app.js --paths "E:\Backup\Pictures,E:\Backup\Documents,F:\Archive" --output "E:\DUPLICATES"
```

work for me on powershell
node app.js --paths "D:\" --output "D:\DUPLICATES"

node app.js --paths "D:\iCloud,D:\BU 03262026\ICloud" --output "D:\DUPLICATES_Icloud" --zip-mode contents

node app.js --paths "D:\" --output "D:\DUPLICATES" --exclude "D:\iCloud\Library" --collect-empty-dirs

node app.js --paths "D:\" --output "D:\DUPLICATES" --empty-dir-only

## Electron Desktop App

This project now also includes an Electron desktop UI.

Files added:

```text
/project
  engine.js
  package.json
  /electron
    main.js
    preload.js
  /renderer
    index.html
    renderer.js
    styles.css
```

### Install Desktop Dependency

```powershell
npm install
```

### Run Electron UI

```powershell
npm start
```

### Build Windows `.exe`

```powershell
npm run dist
```

Build output will be written to:

```text
release/
```

If you only want the unpacked app folder for testing:

```powershell
npm run pack
```

### Desktop Workflow

- Add one or more scan folders
- Add optional excluded folders
- Choose the output folder
- Choose `ZIP Mode`
- Enable `Dry Run` first if needed
- Click `Start Scan`

The desktop app uses the same duplicate engine as the CLI, so scan behavior stays consistent.
