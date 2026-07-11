"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const documentService = require("../services/documentService");

test("resolves stored documents only inside the configured upload root", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mes-doc-integrity-"));
  const file = path.join(root, "drawing.pdf");
  fs.writeFileSync(file, "pdf");
  assert.equal(documentService.resolveStoredFile("uploads/drawing.pdf", root), file);
  assert.equal(documentService.resolveStoredFile("uploads/missing.pdf", root), null);
  assert.equal(documentService.resolveStoredFile("../etc/passwd", root), null);
  fs.rmSync(root, { recursive: true, force: true });
});

test("detects missing document files before issue", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mes-doc-integrity-"));
  assert.equal(documentService.hasStoredFile("uploads/missing.pdf", root), false);
  const file = path.join(root, "real.pdf");
  fs.writeFileSync(file, "pdf");
  assert.equal(documentService.hasStoredFile("uploads/real.pdf", root), true);
  fs.rmSync(root, { recursive: true, force: true });
});
