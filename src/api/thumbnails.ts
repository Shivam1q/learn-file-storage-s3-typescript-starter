import { getBearerToken, validateJWT } from "../auth";
import { respondWithJSON } from "./json";
import { getVideo, updateVideo } from "../db/videos";
import type { ApiConfig } from "../config";
import type { BunRequest } from "bun";
import { BadRequestError, NotFoundError, UserForbiddenError } from "./errors";
import { extension } from "mime-types";
import path from "path";
import { randomBytes } from "crypto";

type Thumbnail = {
  data: ArrayBuffer;
  mediaType: string;
};

export async function handlerUploadThumbnail(cfg: ApiConfig, req: BunRequest) {
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }

  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);

  console.log("uploading thumbnail for video", videoId, "by user", userID);

  const formData = await req.formData();

  const file = formData.get("thumbnail");

  if (!(file instanceof File)) {
    throw new BadRequestError("A thumbnail file is required");
  }

  const MAX_UPLOAD_SIZE = 10 << 20;

  if (file.size > MAX_UPLOAD_SIZE) {
    throw new BadRequestError("File size is greater than 10 MB");
  }

  const fileType = file.type;
  const fileExtension = extension(fileType);

  if (!fileExtension || (fileType !== "image/jpeg" && fileType !== "image/png")) {
    throw new BadRequestError("Unsupported media file");
  }

  const randomFileName = `${randomBytes(32).toString("base64url")}.${fileExtension}`;
  
  const filePath = path.join(cfg.assetsRoot, `${randomFileName}`);
  
  const fileData = await file.arrayBuffer();

  const fileBuffer = Buffer.from(fileData);

  await Bun.write(filePath, fileBuffer);

  const metaData = getVideo(cfg.db, videoId);

  if (metaData?.userID !== userID) {
    throw new UserForbiddenError("forbidden access for the user");
  }

  const thumbnailUrl = `http://localhost:${cfg.port}/assets/${randomFileName}`;

  metaData.thumbnailURL = thumbnailUrl;

  updateVideo(cfg.db, metaData);

  return respondWithJSON(200, metaData);
}
