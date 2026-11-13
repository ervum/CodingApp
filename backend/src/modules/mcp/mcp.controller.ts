import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { McpServerInfoDto, McpToolCallResultDto } from '@robdev/shared';
import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { Public } from '../../common/decorators/public.decorator.js';
import { McpService } from './mcp.service.js';

@Public()
@Controller('mcp')
export class McpController {
  private readonly sseSessions = new Map<string, Response>();

  constructor(private readonly mcp: McpService) {}

  @Get()
  async getRootInfo(@Req() req: Request): Promise<McpServerInfoDto> {
    return this.mcp.getServerInfo(this.resolveBaseUrl(req));
  }

  @Get('info')
  async getInfo(@Req() req: Request): Promise<McpServerInfoDto> {
    return this.mcp.getServerInfo(this.resolveBaseUrl(req));
  }

  @Post()
  async handleJsonRpc(
    @Body() body: unknown,
    @Res() res: Response,
  ): Promise<void> {
    const responsePayload = await this.mcp.handleJsonRpcPayload(body);
    if (responsePayload === null) {
      res.status(202).end();
      return;
    }
    res.status(200).json(responsePayload);
  }

  @Get('sse')
  handleSse(@Req() req: Request, @Res() res: Response): void {
    const sessionId = randomUUID();
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    this.sseSessions.set(sessionId, res);
    const endpointUrl = `/api/mcp/messages?sessionId=${encodeURIComponent(sessionId)}`;
    res.write(`event: endpoint\ndata: ${endpointUrl}\n\n`);

    const keepAlive = setInterval(() => {
      if (!res.writableEnded) {
        res.write(': ping\n\n');
      }
    }, 15_000);

    req.on('close', () => {
      clearInterval(keepAlive);
      this.sseSessions.delete(sessionId);
    });
  }

  @Post('messages')
  async handleSseMessage(
    @Query('sessionId') sessionId: string | undefined,
    @Body() body: unknown,
    @Res() res: Response,
  ): Promise<void> {
    const responsePayload = await this.mcp.handleJsonRpcPayload(body);
    if (sessionId) {
      const sseRes = this.sseSessions.get(sessionId);
      if (sseRes && !sseRes.writableEnded && responsePayload !== null) {
        sseRes.write(`event: message\ndata: ${JSON.stringify(responsePayload)}\n\n`);
      }
    }
    if (responsePayload === null) {
      res.status(202).end();
      return;
    }
    res.status(200).json(responsePayload);
  }

  @Post('tools/:toolName')
  async callToolRest(
    @Param('toolName') toolName: string,
    @Body() args: Record<string, unknown> | undefined,
  ): Promise<McpToolCallResultDto> {
    return this.mcp.executeTool(toolName, args ?? {});
  }

  private resolveBaseUrl(req: Request): string {
    const protoHeader = req.headers['x-forwarded-proto'];
    const protocol =
      typeof protoHeader === 'string'
        ? (protoHeader.split(',')[0] ?? 'http').trim()
        : req.protocol || 'http';
    const host = req.get('host') || 'localhost:3000';
    return `${protocol}://${host}`;
  }
}
