import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { PasswordService } from './password.service.js';
import { TokenService } from './token.service.js';

@Module({
  imports: [JwtModule.register({ global: true })],
  controllers: [AuthController],
  providers: [PasswordService, TokenService, AuthService],
  exports: [AuthService, PasswordService, TokenService],
})
export class AuthModule {}
