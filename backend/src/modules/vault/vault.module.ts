import { Module } from '@nestjs/common';
import { VaultController } from './vault.controller.js';
import { VaultDiskSyncService } from './vault-disk-sync.service.js';
import { VaultLinksService } from './vault-links.service.js';
import { VaultSearchService } from './vault-search.service.js';
import { VaultService } from './vault.service.js';

@Module({
  controllers: [VaultController],
  providers: [VaultLinksService, VaultSearchService, VaultDiskSyncService, VaultService],
  exports: [VaultLinksService, VaultSearchService, VaultDiskSyncService, VaultService],
})
export class VaultModule {}
