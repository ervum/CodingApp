import { type ArgumentMetadata, type PipeTransform } from '@nestjs/common';
import type { z } from 'zod';

export class ZodValidationPipe<TSchema extends z.ZodType>
  implements PipeTransform<unknown, z.infer<TSchema>>
{
  constructor(private readonly schema: TSchema) {}

  transform(value: unknown, _metadata: ArgumentMetadata): z.infer<TSchema> {
    return this.schema.parse(value);
  }
}
