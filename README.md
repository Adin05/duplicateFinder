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

For duplicate `.zip` groups:

- The tool does not extract ZIP files
- All matching ZIP duplicates are moved into:

```text
OUTPUT/zip/
```

## Output Folder Layout

Example:

```text
D:\DUPLICATES
  documents
  images
  others
  videos
  zip
  duplicate-finder.log
```

## Safety Behavior

- Files are moved, never deleted
- If the destination already contains the same filename, the tool renames it:
  - `photo.jpg`
  - `photo (1).jpg`
  - `photo (2).jpg`
- Cross-drive moves are handled safely
- Permission failures are skipped and logged

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

Review the console output and log file, then run without `--dry-run` when you are confident in the results.

## Notes

- The tool currently uses MD5 because it is fast and suitable for duplicate matching workflows
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

work for me
node app.js --paths "D:\" --output "D:\DUPLICATES"