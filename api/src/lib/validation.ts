import type { FastifyInstance } from 'fastify';
import { ZodError, type ZodType } from 'zod';
import { AnonymityViolationError } from './anonymize.js';
import { HttpError } from './errors.js';
import { isProd } from '../config/env.js';

/**
 * Zod als enige validator van Fastify.
 *
 * Door de validatorCompiler te vervangen wordt elk schema dat aan een route
 * hangt, of dat nu body, querystring, params of headers is, door Zod gehaald.
 * Er is dus geen route die per ongeluk zonder validatie kan draaien: als er een
 * schema staat, valideert Zod het, en zo niet dan komt er ook geen invoer uit
 * die bron in de handler terecht.
 */

class FastifyZodError extends Error {
  readonly zodError: ZodError;
  readonly validation: unknown;

  constructor(zodError: ZodError) {
    super('Validatiefout');
    this.name = 'FastifyZodError';
    this.zodError = zodError;
    this.validation = zodError.issues;
  }
}

function formatIssues(error: ZodError): Array<{ path: string; message: string }> {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join('.') || '(root)',
    message: issue.message,
  }));
}

export function registerValidation(app: FastifyInstance): void {
  app.setValidatorCompiler(({ schema }) => {
    const zodSchema = schema as unknown as ZodType;
    return (data: unknown) => {
      const result = zodSchema.safeParse(data);
      if (result.success) return { value: result.data };
      return { error: new FastifyZodError(result.error) as unknown as Error };
    };
  });

  app.setErrorHandler((rawError: unknown, request, reply) => {
    const error = rawError as Error & { statusCode?: number; cause?: unknown };

    if (error instanceof FastifyZodError || error.cause instanceof ZodError) {
      const zodError =
        error instanceof FastifyZodError ? error.zodError : (error.cause as ZodError);
      request.log.info({ issues: zodError.issues }, 'validatie afgewezen');
      return reply.status(400).send({
        error: 'validation_failed',
        message: 'De invoer is niet geldig.',
        details: formatIssues(zodError),
      });
    }

    if (error instanceof HttpError) {
      if (error.statusCode >= 500) request.log.error({ err: error }, 'interne fout');
      return reply.status(error.statusCode).send({
        error: error.code,
        message: error.message,
        ...(error.details !== undefined ? { details: error.details } : {}),
      });
    }

    if (error instanceof AnonymityViolationError) {
      // Dit hoort nooit te gebeuren. Loggen als fout en niets uitleveren.
      request.log.error({ err: error }, 'anonimiseringscontrole afgebroken');
      return reply.status(500).send({
        error: 'internal_error',
        message: 'Interne fout bij het opbouwen van anonieme data.',
      });
    }

    const statusCode = typeof error.statusCode === 'number' ? error.statusCode : 500;
    if (statusCode >= 500) {
      request.log.error({ err: error }, 'onverwachte fout');
    } else {
      request.log.warn({ err: error }, 'verzoek afgewezen');
    }

    return reply.status(statusCode).send({
      error: statusCode >= 500 ? 'internal_error' : 'request_error',
      message:
        statusCode >= 500 && isProd
          ? 'Er ging iets mis. Probeer het later opnieuw.'
          : error.message,
    });
  });

  // De 404-handler wordt in plugins/web.ts gezet: die moet onderscheid maken
  // tussen een onbekend API-pad en een frontendroute die index.html hoort te
  // krijgen.
}
