import { respondWithJSON } from "./json";

import { type ApiConfig } from "../config";
import { S3Client, type BunRequest } from "bun";
import { BadRequestError, UserForbiddenError } from "./errors";
import { getBearerToken, validateJWT } from "../auth";
import { createVideo, getVideo, updateVideo } from "../db/videos";
import { extension } from "mime-types";
import path from "path";
import { getVideoAspectRatio, processVideoForFastStart } from "./middleware";

export async function handlerUploadVideo(cfg: ApiConfig, req: BunRequest) {
  const MAX_SIZE = 1 << 30;

  const { videoId } = req.params as { videoId?: string };

  if (!videoId) {
    throw new BadRequestError("Invalid video id");
  }

  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);

  console.log("uploading thumbnail for video", videoId, "by user", userID);

  const metaData = getVideo(cfg.db, videoId);

  if (metaData?.userID !== userID) {
    throw new UserForbiddenError("user is forbidden");
  }

  const formData = await req.formData();
  const file = formData.get("video");

  if (!(file instanceof File)) {
    throw new BadRequestError("A thumbnail file is required");
  }

  if (file.size > MAX_SIZE) {
    throw new BadRequestError("File size is greater than 1 GB");
  }
  const fileType = file.type;
  const fileExtension = extension(fileType);

  if (!fileExtension || fileType !== "video/mp4") {
    throw new BadRequestError("Unsupported media file");
  }

  const fileName = `${videoId}.${fileExtension}`;

  const filePath = path.join(cfg.assetsRoot, `${fileName}`);

  const fileData = await file.arrayBuffer();

  const fileBuffer = Buffer.from(fileData);

  await Bun.write(filePath, fileBuffer);

  const aspectRatio = await getVideoAspectRatio(`${filePath}`);

  const processedVideoPath = await processVideoForFastStart(filePath);

  const s3 = new S3Client({
    accessKeyId: cfg.awsAccessKey,
    secretAccessKey: cfg.awsSecretAccessKey,
    bucket: cfg.s3Bucket,
  });

  const videoUrl = `https://${cfg.s3CfDistribution}/${aspectRatio}.${fileExtension}`;

  const s3File = s3.file(aspectRatio + "." + fileExtension);
  const body = Bun.file(processedVideoPath);

  await s3File
    .write(body, {
      type: fileType,
    })
    .finally(() => {
      console.log("Uploaded");
    });

  await Bun.file(filePath).delete();
  await Bun.file(processedVideoPath).delete();

  const video = {
    title: metaData.title,
    description: metaData.description,
    thumbnailURL: metaData?.thumbnailURL ?? "",
    videoURL: videoUrl,
    userID: metaData.userID,
    id: videoId,
    updatedAt: metaData.updatedAt,
    createdAt: metaData.createdAt,
  };

  updateVideo(cfg.db, video);

  return respondWithJSON(200, null);
}
