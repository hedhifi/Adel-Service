export const TAKE_PHOTO_LABEL = "Take photo";
export const LIBRARY_LABEL = "Choose from library";
export const LIBRARY_ACCEPT = "image/jpeg,image/png,image/webp";

export type CapturePlan =
  | { kind: "phone-input"; accept: "image/*"; capture: "environment" }
  | { kind: "preview" };

export function planPhotoCapture(env: { coarsePointer: boolean; captureSupported: boolean }): CapturePlan {
  if (env.coarsePointer && env.captureSupported) {
    return { kind: "phone-input", accept: "image/*", capture: "environment" };
  }
  return { kind: "preview" };
}

export function libraryInput() {
  return { label: LIBRARY_LABEL, accept: LIBRARY_ACCEPT, capture: false as const };
}

type CaptureProbe = {
  setAttribute(name: string, value: string): void;
  getAttribute(name: string): string | null;
};

export function captureAttributeSupported(createInput: () => CaptureProbe) {
  try {
    const input = createInput();
    input.setAttribute("capture", "environment");
    return input.getAttribute("capture") === "environment";
  } catch {
    return false;
  }
}

export function describePhotoCapture(env: { coarsePointer: boolean; captureSupported: boolean }) {
  const plan = planPhotoCapture(env);
  const library = libraryInput();
  return {
    takePhotoLabel: TAKE_PHOTO_LABEL,
    library,
    phoneInput: plan.kind === "phone-input" ? { accept: plan.accept, capture: plan.capture } : null,
    desktopPreview: plan.kind === "preview",
    uploadsOnCapture: true,
  };
}

type CameraConstraints = { video: boolean | { facingMode?: string }; audio: false };

export async function openCamera(getUserMedia: (constraints: CameraConstraints) => Promise<unknown>) {
  try {
    return await getUserMedia({ video: { facingMode: "environment" }, audio: false });
  } catch {
    return getUserMedia({ video: true, audio: false });
  }
}

export function stopStream(stream: { getTracks(): { stop(): void }[] }) {
  for (const track of stream.getTracks()) track.stop();
}

export type CaptionFields = {
  caption?: string;
  rawCaption?: string;
};

export type UploadSnapshot = {
  phase: "idle" | "uploading" | "failed" | "done";
  progress: number;
  error: string;
};

export type UploadTransport = (request: {
  url: string;
  body: FormData;
  onProgress: (loaded: number, total: number) => void;
}) => Promise<{ ok: boolean; status: number; message?: string }>;

export function buildPhotoForm(file: Blob, filename: string, fields: CaptionFields) {
  const body = new FormData();
  body.set("file", file, filename);
  body.set("caption", fields.caption ?? "");
  body.set("rawCaption", fields.rawCaption ?? "");
  return body;
}

export function uploadProgress(loaded: number, total: number) {
  if (total <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((loaded / total) * 100)));
}

export class PhotoUploader {
  snapshot: UploadSnapshot = { phase: "idle", progress: 0, error: "" };
  private file: Blob | null = null;
  private filename = "photo.jpg";
  private fields: CaptionFields = {};

  constructor(
    private readonly url: string,
    private readonly transport: UploadTransport,
    private readonly onChange: (snapshot: UploadSnapshot) => void = () => {},
  ) {}

  private emit(next: UploadSnapshot) {
    this.snapshot = next;
    this.onChange(next);
  }

  async send(file: Blob, filename: string, fields: CaptionFields) {
    this.file = file;
    this.filename = filename;
    this.fields = fields;
    await this.run();
  }

  async retry(fields?: CaptionFields) {
    if (!this.file || this.snapshot.phase !== "failed") return;
    if (fields) this.fields = fields;
    await this.run();
  }

  private async run() {
    if (!this.file) return;
    this.emit({ phase: "uploading", progress: 0, error: "" });
    try {
      const result = await this.transport({
        url: this.url,
        body: buildPhotoForm(this.file, this.filename, this.fields),
        onProgress: (loaded, total) => {
          this.emit({ phase: "uploading", progress: uploadProgress(loaded, total), error: "" });
        },
      });
      if (!result.ok) {
        this.emit({
          phase: "failed",
          progress: this.snapshot.progress,
          error: result.message || "Couldn't upload that photo.",
        });
        return;
      }
      this.emit({ phase: "done", progress: 100, error: "" });
    } catch {
      this.emit({ phase: "failed", progress: this.snapshot.progress, error: "Couldn't upload that photo." });
    }
  }
}

export function xhrTransport(): UploadTransport {
  return ({ url, body, onProgress }) =>
    new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", url);
      xhr.withCredentials = true;
      xhr.upload.onprogress = (event) => {
        onProgress(event.loaded, event.lengthComputable ? event.total : 0);
      };
      xhr.onload = () => {
        let message = "";
        try {
          const payload = JSON.parse(xhr.responseText) as { message?: string };
          message = payload.message ?? "";
        } catch {
          message = "";
        }
        resolve({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status, message });
      };
      xhr.onerror = () => reject(new Error("network"));
      xhr.onabort = () => reject(new Error("abort"));
      xhr.send(body);
    });
}
