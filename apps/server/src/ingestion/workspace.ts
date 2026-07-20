import { createHash, randomBytes } from "node:crypto";
import { closeSync, constants, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { SafeIdSchema } from "./schemas.js";
import type { IngestionWorkspace } from "./types.js";

export const REPOSITORY_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
export const DEFAULT_STAGING_ROOT = join(REPOSITORY_ROOT, ".arcwell", "ingestion");
export const DEFAULT_PRODUCTS_ROOT = join(REPOSITORY_ROOT, "knowledge", "products");

export function slugifyId(value: string): string {
  const slug = value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
  return SafeIdSchema.parse(slug || "source");
}

export function sourceIdFromPath(path: string): string {
  return slugifyId(basename(path, extname(path)));
}

export function sourceIdFromUrl(url: string): string {
  const parsed = new URL(url);
  const pathParts = parsed.pathname.split("/").filter(Boolean);
  const videoId = parsed.searchParams.get("v") ?? pathParts[pathParts.length - 1];
  return slugifyId(videoId ? `video-${videoId}` : parsed.hostname);
}

export function assertInside(root: string, candidate: string): string {
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(candidate);
  const fromRoot = relative(resolvedRoot, resolvedCandidate);
  if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new Error(`Path escapes the allowed root: ${candidate}`);
  }
  return resolvedCandidate;
}

export function packagePath(root: string, relativePath: string): string {
  if (relativePath.includes("\\") || isAbsolute(relativePath)) throw new Error(`Invalid package path: ${relativePath}`);
  return assertInside(root, join(root, relativePath));
}

export function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function sha256Value(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function writeJsonAtomic(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${randomBytes(4).toString("hex")}`;
  try {
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    renameSync(temporary, path);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
}

export function createIngestionWorkspace(productId: string, runId?: string): IngestionWorkspace {
  const safeProductId = SafeIdSchema.parse(productId);
  const id = SafeIdSchema.parse(runId ?? `run-${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}-${randomBytes(4).toString("hex")}`);
  const root = join(DEFAULT_STAGING_ROOT, id);
  if (existsSync(root)) throw new Error(`Ingestion run already exists: ${id}`);
  const workspace: IngestionWorkspace = {
    runId: id,
    root,
    preparedDir: join(root, "prepared"),
    checkpointsDir: join(root, "checkpoints"),
    previewsDir: join(root, "previews"),
    finalizedDir: join(root, "finalized"),
    targetDir: join(DEFAULT_PRODUCTS_ROOT, safeProductId)
  };
  for (const directory of [workspace.preparedDir, workspace.checkpointsDir, workspace.previewsDir]) {
    mkdirSync(directory, { recursive: true });
  }
  return workspace;
}

export function existingIngestionWorkspace(productId: string, runId: string): IngestionWorkspace {
  const safeProductId = SafeIdSchema.parse(productId);
  const id = SafeIdSchema.parse(runId);
  const root = join(DEFAULT_STAGING_ROOT, id);
  if (!existsSync(root)) throw new Error(`Ingestion run does not exist: ${id}`);
  return {
    runId: id,
    root,
    preparedDir: join(root, "prepared"),
    checkpointsDir: join(root, "checkpoints"),
    previewsDir: join(root, "previews"),
    finalizedDir: join(root, "finalized"),
    targetDir: join(DEFAULT_PRODUCTS_ROOT, safeProductId)
  };
}

export function registerSourceFile(sourcePath: string, sourceId: string, workspace: IngestionWorkspace): string {
  const resolved = resolve(sourcePath);
  if (!existsSync(resolved)) throw new Error(`Input does not exist: ${sourcePath}`);
  const destinationDir = join(workspace.root, "sources", SafeIdSchema.parse(sourceId));
  mkdirSync(destinationDir, { recursive: true });
  const destination = join(destinationDir, basename(resolved));
  copyFileSync(resolved, destination, constants.COPYFILE_FICLONE);
  return destination;
}

export function acquireRunLock(workspace: IngestionWorkspace): () => void {
  const lock = join(workspace.root, ".lock");
  const descriptor = openSync(lock, "wx");
  closeSync(descriptor);
  return () => rmSync(lock, { force: true });
}

export function atomicPromote(finalizedDir: string, targetDir: string, validate: (directory: string) => void): void {
  validate(finalizedDir);
  mkdirSync(dirname(targetDir), { recursive: true });
  const backup = `${targetDir}.previous-${process.pid}-${randomBytes(4).toString("hex")}`;
  const hadTarget = existsSync(targetDir);
  try {
    if (hadTarget) renameSync(targetDir, backup);
    renameSync(finalizedDir, targetDir);
    rmSync(backup, { recursive: true, force: true });
  } catch (error) {
    if (existsSync(targetDir) && !hadTarget) rmSync(targetDir, { recursive: true, force: true });
    if (hadTarget && existsSync(backup) && !existsSync(targetDir)) renameSync(backup, targetDir);
    throw error;
  }
}
