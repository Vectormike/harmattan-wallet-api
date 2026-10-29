import { HttpException, HttpStatus } from '@nestjs/common';

export class ApiError extends HttpException {
  constructor(
    status: HttpStatus,
    code: string,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(
      {
        statusCode: status,
        code,
        message,
        ...(details ? { details } : {}),
      },
      status,
    );
  }
}
