import { s3, type BunRequest } from "bun";
import { cfg, type ApiConfig } from "../config";
import {
  BadRequestError,
  NotFoundError,
  UserForbiddenError,
  UserNotAuthenticatedError,
} from "./errors";
import { respondWithJSON } from "./json";
import type { Video } from "../db/videos";

type HandlerWithConfig = (cfg: ApiConfig, req: BunRequest) => Promise<Response>;

export function withConfig(cfg: ApiConfig, handler: HandlerWithConfig) {
  return (req: BunRequest) => handler(cfg, req);
}

export function noCacheMiddleware(
  next: (req: Request) => Response | Promise<Response>,
): (req: Request) => Promise<Response> {
  return async function (req: Request): Promise<Response> {
    const res = await next(req);
    const headers = new Headers(res.headers);
    headers.set("Cache-Control", "no-store");

    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers,
    });
  };
}

export function errorHandlingMiddleware(
  cfg: ApiConfig,
  err: unknown,
): Response {
  let statusCode = 500;
  let message = "Something went wrong on our end";

  if (err instanceof BadRequestError) {
    statusCode = 400;
    message = err.message;
  } else if (err instanceof UserNotAuthenticatedError) {
    statusCode = 401;
    message = err.message;
  } else if (err instanceof UserForbiddenError) {
    statusCode = 403;
    message = err.message;
  } else if (err instanceof NotFoundError) {
    statusCode = 404;
    message = err.message;
  }

  if (statusCode >= 500) {
    const errStr = errStringFromError(err);
    if (cfg.platform === "dev") {
      message = errStr;
    }
    console.log(errStr);
  }

  return respondWithJSON(statusCode, { error: message });
}

function errStringFromError(err: unknown) {
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  return "An unknown error occurred";
}

export const getVideoAspectRatio = async (filePath: string) => {
  const proc = Bun.spawn(
    [
      "ffprobe",
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height,display_aspect_ratio",
      "-of",
      "json",
      filePath,
    ],
    {
      stdout: "pipe",
      stderr: "pipe",
    },
  );

  const [exitCode, stdoutText, stderrText] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  if (exitCode !== 0) {
    throw new Error(`ffprobe failed: ${stderrText}`);
  }

  const result = JSON.parse(stdoutText);

  const aspectRatio = result.streams[0].display_aspect_ratio;

  let ratio: string;

  if (aspectRatio === "16:9") {
    ratio = "landscape";
  } else if (aspectRatio === "9:16") {
    ratio = "portrait";
  } else {
    ratio = "others";
  }

  return ratio;
};

export const processVideoForFastStart = async (inputFilePath: string) => {
  const outputFilePath: string = `${inputFilePath}.processed`;

  const proc = Bun.spawn(
    [
      "ffmpeg",
      "-i",
      inputFilePath,
      "-movflags",
      "faststart",
      "-map_metadata",
      "0",
      "-codec",
      "copy",
      "-f",
      "mp4",
      outputFilePath,
    ],
    {
      stdout: "pipe",
      stderr: "pipe",
    },
  );

  const [exitCode, stderrText] = await Promise.all([
    proc.exited,
    new Response(proc.stderr).text(),
  ]);

  if (exitCode !== 0) {
    throw new Error(`Ffmpeg failed: ${stderrText}`);
  }
  return outputFilePath;
};
