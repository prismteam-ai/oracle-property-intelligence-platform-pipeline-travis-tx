import { Logger } from '@aws-lambda-powertools/logger';
import { Metrics, MetricUnit } from '@aws-lambda-powertools/metrics';
import { Tracer } from '@aws-lambda-powertools/tracer';
import type { Observer } from './app.js';

export function createObservability(defaultService: string) {
  const service = process.env.POWERTOOLS_SERVICE_NAME ?? defaultService;
  const namespace = process.env.POWERTOOLS_METRICS_NAMESPACE ?? 'TravisPropertyIntelligence';
  const logger = new Logger({ serviceName: service });
  const metrics = new Metrics({ namespace, serviceName: service });
  const tracer = new Tracer({ serviceName: service });

  const observer: Observer = {
    record(e) {
      // one EMF document per query: QueryServed or QueryFailed, plus ProcessingDuration, each with service, operation and status
      metrics.addDimensions({ operation: e.operation, status: e.status });
      metrics.addMetric(e.status === 'ok' ? 'QueryServed' : 'QueryFailed', MetricUnit.Count, 1);
      metrics.addMetric('ProcessingDuration', MetricUnit.Milliseconds, Math.round(e.durationMs));
      metrics.addMetadata('request_id', e.requestId);
      if (e.count !== undefined) metrics.addMetadata('count', String(e.count));
      metrics.publishStoredMetrics();
      // ids, counts and timings only: never parameters or free text
      logger.info('query', {
        operation: e.operation,
        status: e.status,
        http_status: e.httpStatus,
        duration_ms: Math.round(e.durationMs),
        count: e.count,
        request_id: e.requestId,
      });
      try {
        tracer.putAnnotation('operation', e.operation);
        tracer.putAnnotation('status', e.status);
      } catch {
        /* tracing is off outside Lambda */
      }
    },
    error(msg, err, requestId) {
      logger.error(msg, {
        request_id: requestId,
        error: err instanceof Error ? { name: err.name, message: err.message } : String(err),
      });
    },
  };
  return { logger, metrics, tracer, observer };
}
