import { Global, Module } from '@nestjs/common';
import { SecretBoxService } from '../common/crypto/secret-box.service.js';
import { UrlSignerService } from '../common/crypto/url-signer.service.js';
import { AppConfigService } from '../config/app-config.service.js';
import { PrismaService } from './prisma.service.js';

@Global()
@Module({
  providers: [AppConfigService, PrismaService, SecretBoxService, UrlSignerService],
  exports: [AppConfigService, PrismaService, SecretBoxService, UrlSignerService],
})
export class PrismaModule {}
