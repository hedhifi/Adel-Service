import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { AppError, notFound } from "./errors";
import { log } from "./log";

export type StorageHealth = { ok: boolean; detail: string };

type S3Config = {
  driver: "s3";
  bucket: string;
  region: string;
  endpoint?: string;
  forcePathStyle: boolean;
  accessKeyId: string;
  secretAccessKey: string;
};

type StorageConfig = { driver: "local" } | S3Config | { driver: "s3"; error: string };

export function uploadRoot() {
  const configured = process.env.UPLOAD_DIR ?? "data/uploads";
  return path.isAbsolute(configured) ? configured : path.resolve(process.cwd(), configured);
}

export function normalizeStorageKey(key: string) {
  const cleaned = key.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!cleaned || cleaned.includes("..") || !/^[A-Za-z0-9][A-Za-z0-9/._-]*$/.test(cleaned)) {
    throw new AppError(400, "Invalid storage key.", "invalid_file");
  }
  return cleaned;
}

export function storageConfig(): StorageConfig {
  const driver = (process.env.STORAGE_DRIVER ?? "local").trim().toLowerCase();
  if (driver === "" || driver === "local") return { driver: "local" };
  if (driver !== "s3") return { driver: "s3", error: `Unknown STORAGE_DRIVER "${driver}". Use local or s3.` };
  const bucket = process.env.S3_BUCKET?.trim() ?? "";
  const accessKeyId = process.env.S3_ACCESS_KEY_ID?.trim() ?? "";
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY?.trim() ?? "";
  if (!bucket || !accessKeyId || !secretAccessKey || secretAccessKey.includes("replace")) {
    return {
      driver: "s3",
      error: "STORAGE_DRIVER=s3 needs S3_BUCKET, S3_ACCESS_KEY_ID, and S3_SECRET_ACCESS_KEY.",
    };
  }
  const endpoint = process.env.S3_ENDPOINT?.trim() || undefined;
  const forcePathStyle = process.env.S3_FORCE_PATH_STYLE
    ? process.env.S3_FORCE_PATH_STYLE === "true"
    : Boolean(endpoint);
  return {
    driver: "s3",
    bucket,
    region: process.env.S3_REGION?.trim() || "us-east-1",
    endpoint,
    forcePathStyle,
    accessKeyId,
    secretAccessKey,
  };
}

function localPath(key: string) {
  const root = path.resolve(uploadRoot());
  const full = path.resolve(root, normalizeStorageKey(key));
  if (full !== root && !full.startsWith(`${root}${path.sep}`)) {
    throw new AppError(400, "Invalid storage key.", "invalid_file");
  }
  return full;
}

function missingObject(err: unknown) {
  if (!err || typeof err !== "object") return false;
  const name = "name" in err ? String(err.name) : "";
  const code = "Code" in err ? String(err.Code) : "code" in err ? String(err.code) : "";
  return name === "NoSuchKey" || name === "NotFound" || code === "NoSuchKey" || code === "ENOENT";
}

async function s3Client(config: S3Config) {
  const { S3Client } = await import("@aws-sdk/client-s3");
  return new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: config.forcePathStyle,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
}

export type ObjectStore = {
  driver: "local" | "s3";
  put(key: string, bytes: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  check(): Promise<StorageHealth>;
};

export function objectStore(): ObjectStore {
  const config = storageConfig();
  if ("error" in config) {
    return {
      driver: "s3",
      async put() {
        throw new AppError(503, config.error, "storage_not_configured");
      },
      async get() {
        throw new AppError(503, config.error, "storage_not_configured");
      },
      async check() {
        return { ok: false, detail: config.error };
      },
    };
  }
  if (config.driver === "local") {
    return {
      driver: "local",
      async put(key, bytes) {
        const full = localPath(key);
        await mkdir(path.dirname(full), { recursive: true });
        await writeFile(full, bytes);
      },
      async get(key) {
        try {
          return await readFile(localPath(key));
        } catch (err) {
          if (missingObject(err)) throw notFound("Photo not found.");
          throw err;
        }
      },
      async check() {
        try {
          await mkdir(uploadRoot(), { recursive: true });
          return { ok: true, detail: "local" };
        } catch (err) {
          const message = err instanceof Error ? err.message : "Upload directory is not writable.";
          return { ok: false, detail: message };
        }
      },
    };
  }

  return {
    driver: "s3",
    async put(key, bytes, contentType) {
      const stored = normalizeStorageKey(key);
      const { PutObjectCommand } = await import("@aws-sdk/client-s3");
      const client = await s3Client(config);
      try {
        await client.send(
          new PutObjectCommand({
            Bucket: config.bucket,
            Key: stored,
            Body: bytes,
            ContentType: contentType,
          }),
        );
      } catch (err) {
        log("error", "object storage put failed", { key: stored, message: err instanceof Error ? err.message : "put failed" });
        throw new AppError(502, "Could not store that photo.", "storage_error");
      }
    },
    async get(key) {
      const stored = normalizeStorageKey(key);
      const { GetObjectCommand } = await import("@aws-sdk/client-s3");
      const client = await s3Client(config);
      try {
        const response = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: stored }));
        const bytes = await response.Body?.transformToByteArray();
        if (!bytes) throw notFound("Photo not found.");
        return Buffer.from(bytes);
      } catch (err) {
        if (err instanceof AppError) throw err;
        if (missingObject(err)) throw notFound("Photo not found.");
        log("error", "object storage get failed", { key: stored, message: err instanceof Error ? err.message : "get failed" });
        throw new AppError(502, "Could not read that photo.", "storage_error");
      }
    },
    async check() {
      return { ok: true, detail: "s3" };
    },
  };
}

export async function storageHealth() {
  return objectStore().check();
}
