import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { KnowledgeManifestSchema, SafeIdSchema, type KnowledgeManifest } from "./ingestion/schemas.js";
import { packagePath } from "./ingestion/workspace.js";

export type PackageSearchDocument = {
  id: string;
  documentId?: string;
  source: string;
  page: number;
  title: string;
  text: string;
  image: string;
};

export type LoadedKnowledgePackage = {
  root: string;
  manifest: KnowledgeManifest;
  searchDocuments: PackageSearchDocument[];
  readJson<T>(relativePath: string): T;
  assetPath(relativePath: string): string;
};

export const KNOWLEDGE_ROOT = fileURLToPath(new URL("../../../knowledge/", import.meta.url));

export function activeProductId(): string {
  return SafeIdSchema.parse(process.env.KNOWLEDGE_PRODUCT_ID?.trim() || "omnipro-220");
}

export function productPackageDirectory(productId = activeProductId()): string {
  return join(KNOWLEDGE_ROOT, "products", SafeIdSchema.parse(productId));
}

export function loadKnowledgePackage(directory: string): LoadedKnowledgePackage {
  const root = resolve(directory);
  const manifest = KnowledgeManifestSchema.parse(JSON.parse(readFileSync(packagePath(root, "manifest.json"), "utf8")));
  const searchDocuments = JSON.parse(readFileSync(packagePath(root, "search-documents.json"), "utf8")) as PackageSearchDocument[];
  const documentIds = new Set(manifest.documents.map((document) => document.id));
  const ids = new Set<string>();
  for (const document of searchDocuments) {
    if (ids.has(document.id)) throw new Error(`Duplicate search document id: ${document.id}`);
    ids.add(document.id);
    const sourceId = document.documentId ?? document.source;
    if (!documentIds.has(sourceId)) throw new Error(`Search document ${document.id} references unknown document ${sourceId}.`);
    const source = manifest.documents.find((candidate) => candidate.id === sourceId);
    if (!source || document.page < 1 || document.page > source.pageCount) throw new Error(`Search document ${document.id} has an invalid page.`);
    if (!existsSync(packagePath(root, document.image))) throw new Error(`Search document ${document.id} references missing image ${document.image}.`);
  }
  const readJson = <T>(relativePath: string): T => JSON.parse(readFileSync(packagePath(root, relativePath), "utf8")) as T;
  return { root, manifest, searchDocuments, readJson, assetPath: (relativePath) => packagePath(root, relativePath) };
}

export function hasActiveProductPackage(): boolean {
  return existsSync(join(productPackageDirectory(), "manifest.json"));
}
