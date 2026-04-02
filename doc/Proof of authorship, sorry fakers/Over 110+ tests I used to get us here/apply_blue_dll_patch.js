/*
 * Proof-of-authorship note: Primary authorship and project direction for this patch script belong to John Elysian.
 * This file is kept here as part of the EveJS proof-of-authorship record after repeated misattribution of the underlying work and claims that it was trivial.
 * If you reuse, discuss, or share this file, please credit it accurately.
 */

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_MANIFEST_PATH = path.join(REPO_ROOT, 'PATCHED_FILES', 'blue-dll.patch.json');

function printUsage() {
  console.log([
    'Usage:',
    '  node scripts/internal/apply_blue_dll_patch.js --input <path-to-blue.dll> [--output <path>]',
    '  node scripts/internal/apply_blue_dll_patch.js --input <path-to-blue.dll> --in-place [--backup-suffix .original]',
    '',
    'Options:',
    '  --input <path>          Path to the original blue.dll to patch.',
    '  --output <path>         Where to write the patched DLL. Defaults to <input>.patched.dll.',
    '  --in-place              Replace the input file in place. Creates a backup first.',
    '  --backup-suffix <text>  Backup suffix for --in-place. Defaults to .original.',
    '  --manifest <path>       Override the patch manifest path.',
    '  --force                 Overwrite an existing output file.',
    '  --help                  Show this message.',
  ].join('\n'));
}

function fail(message) {
  throw new Error(message);
}

function parseArgs(argv) {
  const options = {
    backupSuffix: '.original',
    manifestPath: DEFAULT_MANIFEST_PATH,
    force: false,
    inPlace: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg === '--in-place') {
      options.inPlace = true;
      continue;
    }
    if (arg === '--force') {
      options.force = true;
      continue;
    }

    const nextValue = () => {
      if (index + 1 >= argv.length) {
        fail(`Missing value for ${arg}`);
      }
      index += 1;
      return argv[index];
    };

    if (arg === '--input') {
      options.inputPath = nextValue();
      continue;
    }
    if (arg === '--output') {
      options.outputPath = nextValue();
      continue;
    }
    if (arg === '--backup-suffix') {
      options.backupSuffix = nextValue();
      continue;
    }
    if (arg === '--manifest') {
      options.manifestPath = nextValue();
      continue;
    }

    if (!arg.startsWith('--') && !options.inputPath) {
      options.inputPath = arg;
      continue;
    }

    fail(`Unknown argument: ${arg}`);
  }

  return options;
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function hexToBuffer(hexValue, fieldName) {
  if (typeof hexValue !== 'string' || hexValue.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hexValue)) {
    fail(`Invalid hex in ${fieldName}`);
  }
  return Buffer.from(hexValue, 'hex');
}

function readManifest(manifestPath) {
  const raw = fs.readFileSync(manifestPath, 'utf8');
  return JSON.parse(raw);
}

function buildDefaultOutputPath(inputPath) {
  const parsed = path.parse(inputPath);
  return path.join(parsed.dir, `${parsed.name}.patched${parsed.ext}`);
}

function ensurePatchableSource(inputBuffer, manifest, inputPath) {
  const inputHash = sha256(inputBuffer);
  if (inputHash === manifest.target.sha256) {
    console.log(`Already patched: ${inputPath}`);
    console.log(`SHA-256: ${inputHash}`);
    return { alreadyPatched: true, inputHash };
  }

  if (inputBuffer.length !== manifest.source.size) {
    fail(`Unexpected input size. Expected ${manifest.source.size}, got ${inputBuffer.length}.`);
  }
  if (inputHash !== manifest.source.sha256) {
    fail([
      'Input blue.dll does not match the expected original build.',
      `Expected SHA-256: ${manifest.source.sha256}`,
      `Actual SHA-256:   ${inputHash}`,
    ].join('\n'));
  }

  return { alreadyPatched: false, inputHash };
}

function applyFixedPatches(sourceBuffer, manifest) {
  const output = Buffer.from(sourceBuffer);

  for (const patch of manifest.patches || []) {
    const before = hexToBuffer(patch.beforeHex, `${patch.offsetHex}.beforeHex`);
    const after = hexToBuffer(patch.afterHex, `${patch.offsetHex}.afterHex`);
    if (before.length !== after.length) {
      fail(`Patch length mismatch at ${patch.offsetHex}`);
    }
    if (patch.offset < 0 || patch.offset + before.length > output.length) {
      fail(`Patch offset out of range at ${patch.offsetHex}`);
    }

    const current = output.subarray(patch.offset, patch.offset + before.length);
    if (!current.equals(before)) {
      fail([
        `Unexpected bytes at ${patch.offsetHex}.`,
        `Expected: ${before.toString('hex')}`,
        `Actual:   ${current.toString('hex')}`,
      ].join('\n'));
    }

    after.copy(output, patch.offset);
  }

  return output;
}

function inflateOverlay(overlay) {
  if (!overlay || overlay.compression !== 'deflate') {
    fail('Only deflate-compressed overlay patches are supported.');
  }

  const overlayBuffer = zlib.inflateSync(Buffer.from(overlay.dataBase64, 'base64'));
  if (overlayBuffer.length !== overlay.afterSize) {
    fail(`Overlay length mismatch after inflate. Expected ${overlay.afterSize}, got ${overlayBuffer.length}.`);
  }
  if (sha256(overlayBuffer) !== overlay.afterSha256) {
    fail('Overlay SHA-256 does not match the manifest.');
  }

  return overlayBuffer;
}

function applyOverlayPatchedBuffer(bufferWithFixedPatches, sourceBuffer, manifest) {
  const overlay = manifest.overlay;
  if (!overlay) {
    return bufferWithFixedPatches;
  }

  const sourceOverlay = sourceBuffer.subarray(overlay.offset);
  if (sourceOverlay.length !== overlay.beforeSize) {
    fail(`Unexpected source overlay size. Expected ${overlay.beforeSize}, got ${sourceOverlay.length}.`);
  }
  if (sha256(sourceOverlay) !== overlay.beforeSha256) {
    fail('Source overlay SHA-256 does not match the manifest.');
  }

  const patchedOverlay = inflateOverlay(overlay);
  return Buffer.concat([
    bufferWithFixedPatches.subarray(0, overlay.offset),
    patchedOverlay,
  ]);
}

function writePatchedFile(options, patchedBuffer) {
  const inputPath = path.resolve(options.inputPath);

  if (options.inPlace) {
    const backupPath = `${inputPath}${options.backupSuffix}`;
    if (!fs.existsSync(backupPath)) {
      fs.copyFileSync(inputPath, backupPath);
      console.log(`Backup created: ${backupPath}`);
    } else {
      console.log(`Backup already exists: ${backupPath}`);
    }

    fs.writeFileSync(inputPath, patchedBuffer);
    return inputPath;
  }

  const outputPath = path.resolve(options.outputPath || buildDefaultOutputPath(inputPath));
  if (outputPath !== inputPath && fs.existsSync(outputPath) && !options.force) {
    fail(`Output file already exists: ${outputPath}. Re-run with --force to overwrite it.`);
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, patchedBuffer);
  return outputPath;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return 0;
  }
  if (!options.inputPath) {
    printUsage();
    return 1;
  }

  const manifestPath = path.resolve(options.manifestPath);
  const inputPath = path.resolve(options.inputPath);
  const manifest = readManifest(manifestPath);
  const inputBuffer = fs.readFileSync(inputPath);

  console.log(`Manifest: ${manifestPath}`);
  console.log(`Input:    ${inputPath}`);

  const sourceState = ensurePatchableSource(inputBuffer, manifest, inputPath);
  if (sourceState.alreadyPatched) {
    return 0;
  }

  const fixedPatched = applyFixedPatches(inputBuffer, manifest);
  const fullyPatched = applyOverlayPatchedBuffer(fixedPatched, inputBuffer, manifest);
  const finalHash = sha256(fullyPatched);

  if (fullyPatched.length !== manifest.target.size) {
    fail(`Unexpected output size. Expected ${manifest.target.size}, got ${fullyPatched.length}.`);
  }
  if (finalHash !== manifest.target.sha256) {
    fail([
      'Final SHA-256 does not match the manifest target hash.',
      `Expected: ${manifest.target.sha256}`,
      `Actual:   ${finalHash}`,
    ].join('\n'));
  }

  const writtenPath = writePatchedFile(options, fullyPatched);
  console.log(`Patched file written: ${writtenPath}`);
  console.log(`SHA-256: ${finalHash}`);
  console.log(`Applied ${manifest.patches.length} fixed patch(es) and replaced the certificate overlay.`);
  return 0;
}

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(error.message || String(error));
    process.exitCode = 1;
  }
}
