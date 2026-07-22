import type { Request, Response, NextFunction } from 'express-serve-static-core';
import { z } from 'zod';

/**
 * Express middleware factory for Zod validation
 *
 * @param schema - Zod schema to validate against
 * @param source - Where to find the data to validate ('body', 'query', 'params')
 */
export function validateRequest<T extends z.ZodTypeAny>(
  schema: T,
  source: 'body' | 'query' | 'params' = 'body'
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    let data: unknown;
    if (source === 'body') {
      data = req.body;
    } else if (source === 'query') {
      data = req.query;
    } else {
      data = req.params;
    }

    const result = schema.safeParse(data);

    if (!result.success) {
      const errors = result.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      }));

      res.status(400).json({
        error: 'Validation failed',
        details: errors,
      });
      return;
    }

    // Replace the source data with the validated and transformed data.
    // Augment the Express Request type so `req.body` carries the
    // schema-derived type instead of `any` for downstream handlers.
    if (source === 'body') {
      (req as Request & { body: z.infer<T> }).body = result.data;
    }
    next();
  };
}

/**
 * Validate multiple sources at once
 */
export function validateMultiple(schemas: {
  body?: z.ZodTypeAny;
  query?: z.ZodTypeAny;
  params?: z.ZodTypeAny;
}) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const errors: Array<{ source: string; field: string; message: string }> = [];

    for (const [source, schema] of Object.entries(schemas) as Array<
      ['body' | 'query' | 'params', z.ZodTypeAny]
    >) {
      if (schema) {
        let data: unknown;
        if (source === 'body') {
          data = req.body;
        } else if (source === 'query') {
          data = req.query;
        } else {
          data = req.params;
        }

        const result = schema.safeParse(data);
        if (!result.success) {
          result.error.issues.forEach((issue) => {
            errors.push({
              source,
              field: issue.path.join('.'),
              message: issue.message,
            });
          });
        } else if (source === 'body') {
          (req as Request & { body: z.infer<typeof schema> }).body = result.data;
        }
      }
    }

    if (errors.length > 0) {
      res.status(400).json({
        error: 'Validation failed',
        details: errors,
      });
      return;
    }

    next();
  };
}
