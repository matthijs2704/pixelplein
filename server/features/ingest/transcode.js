'use strict';

const path         = require('path');
const fs           = require('fs');
const { spawn }    = require('child_process');

// Extensions that require transcoding to .mp4 for Chromium compatibility
const TRANSCODE_EXTS = /\.(mov|m4v)$/i;

/**
 * Returns true if the filename needs transcoding before it can be served
 * to a Chromium-based player.
 *
 * @param {string} filename
 * @returns {boolean}
 */
function needsTranscode(filename) {
  return TRANSCODE_EXTS.test(filename);
}

/**
 * Parse HH:MM:SS.ms or HH:MM:SS time string to seconds.
 * @param {string} t
 * @returns {number}
 */
function _parseTime(t) {
  const parts = t.split(':');
  if (parts.length !== 3) return 0;
  return parseInt(parts[0], 10) * 3600 + parseInt(parts[1], 10) * 60 + parseFloat(parts[2]);
}

/**
 * Transcodes a .mov or .m4v file to an H.264/AAC .mp4 using ffmpeg.
 * The output file is written alongside the input with a .mp4 extension.
 *
 * @param {string}   inputPath   Absolute path to the source file
 * @param {Function} [onProgress]  Called with (pct: number 0–100) ~once per second
 * @returns {Promise<string>} Resolves with the output .mp4 path on success
 */
function transcodeToMp4(inputPath, onProgress) {
  const ext        = path.extname(inputPath);
  const outputPath = inputPath.slice(0, -ext.length) + '.mp4';
  const filename   = path.basename(inputPath);

  console.log(`[transcode] Starting: ${filename} → ${path.basename(outputPath)}`);

  return new Promise((resolve, reject) => {
    const args = [
      '-i',  inputPath,
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-crf', '23',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-movflags', '+faststart',  // moov atom first — required for HTTP range streaming
      '-y',                        // overwrite without prompt
      outputPath,
    ];

    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });

    let stderr         = '';
    let totalSec       = 0;
    let lastReportedAt = 0;

    proc.stderr.on('data', chunk => {
      const text = chunk.toString();
      stderr += text;

      // Extract total duration once from the header block
      if (!totalSec) {
        const m = text.match(/Duration:\s*(\d+:\d+:\d+(?:\.\d+)?)/);
        if (m) totalSec = _parseTime(m[1]);
      }

      // Extract current encode position and report progress ~1/sec
      if (totalSec && onProgress) {
        const m = text.match(/time=(\d+:\d+:\d+(?:\.\d+)?)/);
        if (m) {
          const curSec = _parseTime(m[1]);
          const pct    = Math.min(99, Math.round((curSec / totalSec) * 100));
          const now    = Date.now();
          if (now - lastReportedAt >= 1000) {
            lastReportedAt = now;
            onProgress(pct);
          }
        }
      }
    });

    proc.on('error', err => {
      if (err.code === 'ENOENT') {
        reject(new Error('ffmpeg not found — install ffmpeg to enable .mov/.m4v transcoding'));
      } else {
        reject(err);
      }
    });

    proc.on('close', code => {
      if (code === 0) {
        if (onProgress) onProgress(100);
        console.log(`[transcode] Done: ${path.basename(outputPath)}`);
        resolve(outputPath);
      } else {
        // Include last few lines of stderr for diagnosis
        const hint = stderr.split('\n').filter(Boolean).slice(-4).join(' | ');
        reject(new Error(`ffmpeg exited ${code}: ${hint}`));
      }
    });
  });
}

module.exports = { needsTranscode, transcodeToMp4 };
