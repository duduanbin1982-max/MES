"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const UPLOAD_ROOT = process.env.DOCUMENT_UPLOAD_ROOT || path.join("/home/dubin/factory-mes/data", "uploads");

function resolveStoredFile(filePath, uploadRoot = UPLOAD_ROOT) {
  if (!filePath) return null;
  const normalized = String(filePath).replace(/\\/g, "/").replace(/^uploads\//, "");
  const root = path.resolve(uploadRoot);
  const absolute = path.resolve(root, normalized);
  if (absolute !== root && !absolute.startsWith(root + path.sep)) return null;
  return fs.existsSync(absolute) && fs.statSync(absolute).isFile() ? absolute : null;
}

function hasStoredFile(filePath, uploadRoot = UPLOAD_ROOT) {
  return Boolean(resolveStoredFile(filePath, uploadRoot));
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function buildStoragePath(fileName) {
  const now = new Date();
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const uniqueName = `${now.getTime()}_${Math.random().toString(36).slice(2, 8)}${path.extname(fileName) || ""}`;
  const directory = path.join(UPLOAD_ROOT, year, month);
  fs.mkdirSync(directory, { recursive: true });
  return {
    dir: directory,
    rel: path.join("uploads", year, month, uniqueName),
    abs: path.join(directory, uniqueName),
  };
}

function mimeToIcon(mime) {
  if (!mime) return "📄";
  if (mime.includes("pdf")) return "📕";
  if (mime.startsWith("image/")) return "🖼️";
  if (mime.includes("dwg") || mime.includes("cad")) return "📐";
  if (mime.includes("zip") || mime.includes("rar")) return "🗜️";
  if (mime.includes("excel") || mime.includes("spreadsheet")) return "📊";
  if (mime.includes("word") || mime.includes("document")) return "📝";
  return "📄";
}

function humanSize(bytes) {
  if (!bytes) return "-";
  const units = ["B", "KB", "MB", "GB"];
  let index = 0;
  let size = bytes;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size.toFixed(size < 10 ? 2 : 1)} ${units[index]}`;
}

module.exports = { UPLOAD_ROOT, resolveStoredFile, hasStoredFile, sha256, buildStoragePath, mimeToIcon, humanSize };
