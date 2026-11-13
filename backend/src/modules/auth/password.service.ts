import { hash, verify, type Algorithm } from '@node-rs/argon2';
import { Injectable, type OnModuleInit } from '@nestjs/common';

const ARGON2_OPTIONS = {
  algorithm: 2 as Algorithm,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

@Injectable()
export class PasswordService implements OnModuleInit {
  private dummyHash = '';

  async onModuleInit(): Promise<void> {
    this.dummyHash = await this.hash('robdev-constant-time-dummy-password');
  }

  async hash(plain: string): Promise<string> {
    return hash(plain, ARGON2_OPTIONS);
  }

  async verify(storedHash: string | null | undefined, plain: string): Promise<boolean> {
    const targetHash =
      storedHash ??
      (this.dummyHash || (await this.hash('robdev-constant-time-dummy-password')));
    try {
      const matched = await verify(targetHash, plain);
      return storedHash ? matched : false;
    } catch {
      return false;
    }
  }
}
