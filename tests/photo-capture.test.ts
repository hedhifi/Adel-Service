import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  LIBRARY_LABEL,
  PhotoUploader,
  TAKE_PHOTO_LABEL,
  captureAttributeSupported,
  describePhotoCapture,
  libraryInput,
  openCamera,
  planPhotoCapture,
  type UploadSnapshot,
} from "../apps/web/src/lib/photo-capture";

const root = path.resolve(import.meta.dirname, "..");

function read(relative: string) {
  return readFileSync(path.join(root, relative), "utf8");
}

describe("photo capture", () => {
  it("uses a rear-camera input on phones and a live preview on desktops", () => {
    const phone = describePhotoCapture({ coarsePointer: true, captureSupported: true });
    expect(phone.takePhotoLabel).toBe(TAKE_PHOTO_LABEL);
    expect(phone.phoneInput).toEqual({ accept: "image/*", capture: "environment" });
    expect(phone.desktopPreview).toBe(false);
    expect(planPhotoCapture({ coarsePointer: true, captureSupported: true }).kind).toBe("phone-input");

    const desktop = describePhotoCapture({ coarsePointer: false, captureSupported: true });
    expect(desktop.phoneInput).toBeNull();
    expect(desktop.desktopPreview).toBe(true);

    const fallback = describePhotoCapture({ coarsePointer: true, captureSupported: false });
    expect(fallback.phoneInput).toBeNull();
    expect(fallback.desktopPreview).toBe(true);
    expect(captureAttributeSupported(() => ({ setAttribute() {}, getAttribute: () => null }))).toBe(false);
  });

  it("keeps library upload beside take photo, without the capture attribute", () => {
    const library = libraryInput();
    expect(library.label).toBe(LIBRARY_LABEL);
    expect(library.accept).toBe("image/jpeg,image/png,image/webp");
    expect(library.capture).toBe(false);
    for (const env of [
      { coarsePointer: true, captureSupported: true },
      { coarsePointer: false, captureSupported: true },
      { coarsePointer: true, captureSupported: false },
    ]) {
      expect(describePhotoCapture(env).library).toEqual(library);
      expect(describePhotoCapture(env).uploadsOnCapture).toBe(true);
    }
  });

  it("uploads as soon as a photo is captured and reports progress", async () => {
    const seen: UploadSnapshot[] = [];
    let calls = 0;
    const uploader = new PhotoUploader("/api/v1/visits/visit/photos", async ({ url, body, onProgress }) => {
      calls += 1;
      expect(url).toBe("/api/v1/visits/visit/photos");
      expect(body.get("caption")).toBe("Panel schedule");
      const file = body.get("file");
      expect(file).toBeInstanceOf(Blob);
      expect((file as Blob).size).toBe(3);
      onProgress(1, 4);
      onProgress(4, 4);
      return { ok: true, status: 201 };
    }, (snapshot) => seen.push({ ...snapshot }));

    const started = Date.now();
    await uploader.send(new Blob([Uint8Array.from([1, 2, 3])], { type: "image/jpeg" }), "panel.jpg", { caption: "Panel schedule" });
    expect(Date.now() - started).toBeLessThan(1000);
    expect(calls).toBe(1);
    expect(seen.map((snapshot) => snapshot.progress)).toEqual([0, 25, 100, 100]);
    expect(uploader.snapshot.phase).toBe("done");
  });

  it("retries the same photo after the upload fails", async () => {
    const sizes: number[] = [];
    let calls = 0;
    const uploader = new PhotoUploader("/api/v1/visits/visit/photos", async ({ body, onProgress }) => {
      calls += 1;
      const file = body.get("file");
      sizes.push((file as Blob).size);
      onProgress(2, 4);
      if (calls === 1) throw new Error("signal dropped");
      return { ok: true, status: 201 };
    });
    const photo = new Blob([Uint8Array.from([9, 8, 7, 6])], { type: "image/jpeg" });
    await uploader.send(photo, "photo.jpg", {});
    expect(uploader.snapshot.phase).toBe("failed");
    expect(uploader.snapshot.error).toBe("Couldn't upload that photo.");
    expect(uploader.snapshot.progress).toBe(50);
    await uploader.retry();
    expect(calls).toBe(2);
    expect(sizes).toEqual([4, 4]);
    expect(uploader.snapshot.phase).toBe("done");
  });

  it("falls back to any webcam when the rear camera is missing", async () => {
    const asked: Array<boolean | { facingMode?: string }> = [];
    const stream = { id: "desk" };
    const opened = await openCamera(async (constraints) => {
      asked.push(constraints.video);
      if (typeof constraints.video === "object" && constraints.video.facingMode === "environment") {
        throw new Error("no rear camera");
      }
      return stream;
    });
    expect(opened).toBe(stream);
    expect(asked).toEqual([{ facingMode: "environment" }, true]);
  });

  it("uses the same component on the tech visit and the office job", () => {
    const component = read("apps/web/src/components/photo-capture.tsx");
    const visit = read("apps/web/src/app/tech/visits/[id]/page.tsx");
    const job = read("apps/web/src/app/(office)/jobs/[id]/page.tsx");
    expect(component).toContain('capture="environment"');
    expect(component).toContain("planPhotoCapture");
    expect(component).toContain("queuePhoto");
    expect(component).toContain("PhotoUploader");
    expect(visit).toContain("<PhotoCapture");
    expect(job).toContain("<PhotoCapture");
    expect(visit).not.toContain('capture="environment"');
    expect(job).not.toContain('capture="environment"');
  });
});
