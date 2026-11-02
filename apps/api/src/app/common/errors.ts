import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { ApiError } from '@trialmatch/shared';
import type { Response } from 'express';
import { ZodValidationException } from 'nestjs-zod';
import type { ZodError } from 'zod';

/** 409 Conflict carrying the record as it is now, so the client can show "yours vs theirs". */
export class VersionConflict extends HttpException {
  constructor(current: unknown) {
    super(
      {
        statusCode: HttpStatus.CONFLICT,
        message: 'Someone else saved this record after you opened it.',
        current,
      } satisfies ApiError,
      HttpStatus.CONFLICT,
    );
  }
}

/** 400 with field-level messages, the same shape as request validation errors. */
export class FieldError extends HttpException {
  constructor(field: string, message: string) {
    super(
      {
        statusCode: 400,
        message: 'Validation failed',
        fieldErrors: { [field]: message },
      } satisfies ApiError,
      400,
    );
  }
}

/** Every error leaves the API in one shape: ApiError (see libs/shared). */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly log = new Logger('ApiExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const body = this.toBody(exception);
    if (body.statusCode >= 500) this.log.error(exception);
    res.status(body.statusCode).json(body);
  }

  private toBody(exception: unknown): ApiError {
    if (exception instanceof ZodValidationException) {
      const zodError = exception.getZodError() as ZodError;
      const fieldErrors: Record<string, string> = {};
      for (const issue of zodError.issues) {
        const key = issue.path.join('.') || '_';
        fieldErrors[key] ??= issue.message;
      }
      return { statusCode: 400, message: 'Validation failed', fieldErrors };
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      if (
        typeof response === 'object' &&
        response !== null &&
        'statusCode' in response
      ) {
        const r = response as ApiError & { message: string | string[] };
        return {
          ...r,
          message: Array.isArray(r.message) ? r.message.join('; ') : r.message,
        };
      }
      return { statusCode: status, message: String(response) };
    }
    return {
      statusCode: 500,
      message: 'Something went wrong. Please try again.',
    };
  }
}
