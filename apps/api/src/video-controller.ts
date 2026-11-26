import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";
import { AccessGuard, type AuthRequest } from "./access";
import {
  acceptVideo,
  adminSessions,
  checkCamera,
  closeCamera,
  openCamera,
  recordingFile,
  watch,
} from "./video";

@Controller("api")
@UseGuards(AccessGuard)
export class VideoController {
  @Post("me/video-consent") consent(
    @Req() r: AuthRequest,
    @Body() body: unknown,
  ) {
    return acceptVideo(r.ctx, body);
  }
  @Post("attempts/:id/camera") open(
    @Req() r: AuthRequest,
    @Param("id") id: string,
  ) {
    return openCamera(r.ctx, id);
  }
  @Post("video/:id/check") check(
    @Req() r: AuthRequest,
    @Param("id") id: string,
  ) {
    return checkCamera(r.ctx, id);
  }
  @Post("video/:id/close") close(
    @Req() r: AuthRequest,
    @Param("id") id: string,
  ) {
    return closeCamera(r.ctx, id);
  }
  @Get("video") list(
    @Req() r: AuthRequest,
    @Query("campaignId") campaignId: string,
  ) {
    return adminSessions(r.ctx, campaignId);
  }
  @Post("video/:id/watch") watch(
    @Req() r: AuthRequest,
    @Param("id") id: string,
  ) {
    return watch(r.ctx, id);
  }
  @Get("video/:id/download") async download(
    @Req() r: AuthRequest,
    @Param("id") id: string,
    @Res() res: Response,
  ) {
    const file = await recordingFile(r.ctx, id);
    res.set("Cache-Control", "private, no-store");
    res.download(file, "AssessFlow-" + id + ".webm", { dotfiles: "allow" });
  }
}
