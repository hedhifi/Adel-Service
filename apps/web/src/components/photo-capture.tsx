"use client";

import { VoiceField } from "@/components/voice-field";
import { buttonClass, ghostClass } from "@/components/ui";
import {
  TAKE_PHOTO_LABEL,
  captureAttributeSupported,
  libraryInput,
  openCamera,
  planPhotoCapture,
  PhotoUploader,
  stopStream,
  xhrTransport,
  type CaptionFields,
  type UploadSnapshot,
} from "@/lib/photo-capture";
import type { DictationLanguage } from "@adel/core/speech";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ChangeEvent } from "react";

const idle: UploadSnapshot = { phase: "idle", progress: 0, error: "" };

export function PhotoCapture({
  visitId,
  phrases,
  defaultLanguage,
}: {
  visitId: string;
  phrases: string[];
  defaultLanguage: DictationLanguage;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const captureRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const uploaderRef = useRef<PhotoUploader | null>(null);
  const [snapshot, setSnapshot] = useState<UploadSnapshot>(idle);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState("");
  const library = libraryInput();

  if (!uploaderRef.current) {
    uploaderRef.current = new PhotoUploader(`/api/v1/visits/${visitId}/photos`, xhrTransport(), (next) => {
      if (next.phase === "done") {
        setSnapshot(idle);
        setCameraError("");
        router.refresh();
        return;
      }
      setSnapshot(next);
    });
  }

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !stream) return;
    video.srcObject = stream;
    void video.play().catch(() => {});
    return () => {
      video.srcObject = null;
    };
  }, [stream]);

  useEffect(() => {
    return () => {
      if (stream) stopStream(stream);
    };
  }, [stream]);

  function readCaption(): CaptionFields {
    const form = formRef.current;
    if (!form) return {};
    const data = new FormData(form);
    return {
      caption: String(data.get("caption") ?? ""),
      rawCaption: String(data.get("rawCaption") ?? ""),
    };
  }

  function queuePhoto(file: Blob, filename: string) {
    void uploaderRef.current?.send(file, filename, readCaption());
  }

  function onPicked(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || file.size === 0) return;
    queuePhoto(file, file.name || "photo.jpg");
  }

  function closePreview() {
    if (stream) stopStream(stream);
    setStream(null);
  }

  async function takePhoto() {
    setCameraError("");
    const plan = planPhotoCapture({
      coarsePointer: window.matchMedia("(pointer: coarse)").matches,
      captureSupported: captureAttributeSupported(() => document.createElement("input")),
    });
    if (plan.kind === "phone-input") {
      captureRef.current?.click();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError("The camera isn't available. You can still choose a photo from the library.");
      return;
    }
    try {
      const next = (await openCamera((constraints) => navigator.mediaDevices.getUserMedia(constraints))) as MediaStream;
      closePreview();
      setStream(next);
    } catch {
      setCameraError("The camera isn't available. You can still choose a photo from the library.");
    }
  }

  function captureFrame() {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          setCameraError("The camera didn't produce a photo. You can still choose one from the library.");
          return;
        }
        closePreview();
        queuePhoto(blob, "photo.jpg");
      },
      "image/jpeg",
      0.92,
    );
  }

  return (
    <form ref={formRef} className="space-y-2" onSubmit={(event) => event.preventDefault()}>
      <VoiceField
        name="caption"
        rawName="rawCaption"
        phrases={phrases}
        defaultLanguage={defaultLanguage}
        languageName="captionLanguage"
        placeholder="Caption"
        label="Caption"
      />
      <div className="relative flex flex-wrap gap-2">
        <button className={buttonClass} type="button" onClick={() => void takePhoto()}>
          {TAKE_PHOTO_LABEL}
        </button>
        <button className={ghostClass} type="button" onClick={() => libraryRef.current?.click()}>
          {library.label}
        </button>
        <input
          ref={captureRef}
          className="absolute h-px w-px overflow-hidden opacity-0"
          type="file"
          accept="image/*"
          capture="environment"
          tabIndex={-1}
          aria-hidden="true"
          onChange={onPicked}
        />
        <input
          ref={libraryRef}
          className="absolute h-px w-px overflow-hidden opacity-0"
          type="file"
          accept={library.accept}
          tabIndex={-1}
          aria-hidden="true"
          onChange={onPicked}
        />
      </div>
      {stream ? (
        <div className="space-y-2">
          <video ref={videoRef} className="aspect-[4/3] w-full rounded-md bg-black object-cover" autoPlay muted playsInline />
          <div className="flex flex-wrap gap-2">
            <button className={buttonClass} type="button" onClick={captureFrame}>
              Capture
            </button>
            <button className={ghostClass} type="button" onClick={closePreview}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
      {snapshot.phase === "uploading" ? (
        <div className="space-y-1">
          <p className="text-xs text-muted">Uploading {snapshot.progress}%</p>
          <progress className="h-2 w-full" max={100} value={snapshot.progress} aria-label="Upload progress" />
        </div>
      ) : null}
      {snapshot.phase === "failed" ? (
        <div className="space-y-2">
          <p className="text-sm text-danger" role="alert">
            {snapshot.error}
          </p>
          <button className={ghostClass} type="button" onClick={() => void uploaderRef.current?.retry(readCaption())}>
            Retry
          </button>
        </div>
      ) : null}
      {cameraError ? <p className="text-sm text-danger">{cameraError}</p> : null}
    </form>
  );
}
