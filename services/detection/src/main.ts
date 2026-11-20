// Entry of the detection service, wiring only (ticket #25): configuration, one Redis connection, the probes and
// the lifecycle of the service kit, and the Session routes on the same connection (ticket #27, src/session/). With a
// model adapter (MODEL_ADAPTER, ticket #29) each Session runs the Claim Extractor through it, and with
// TOPIC_EXTRACTOR_PROMPT_FILE also the Topic Extractor through its own mock (#32); without one it calls no
// model. Nothing starts on import; `node src/main.ts` starts it.
import {
  createMockClaimExtractor,
  createMockTopicExtractor,
  parseExpectations,
  type ModelAdapter,
} from '@lfc/providers';
import {
  ConfigError,
  createLogger,
  errorCode,
  runService,
  writeConfigError,
  type Env,
  type Logger,
  type Signals,
} from '@lfc/service-kit';
import { Redis } from 'ioredis';

import {
  loadConfig,
  type ClaimExtractorConfig,
  type DetectionConfig,
  type TopicExtractorConfig,
} from './config.ts';
import {
  createSessionPipelines,
  type ClosableSessionPipelines,
} from './session/session-pipelines.ts';
import { createSessionRoutes } from './session/routes.ts';
import { createSessionRecords, createSessionStore } from './session/store.ts';

export interface DetectionOptions {
  readonly env: Env;
  readonly write?: ((line: string) => void) | undefined;
  readonly exit?: ((code: number) => void) | undefined;
  readonly signals?: Signals | undefined;
}

/** QUIT gets this long on SIGTERM; then the connection is dropped. */
const QUIT_TIMEOUT_MS = 2000;

function connect(config: DetectionConfig): Redis {
  const { host, port, db, tls } = config.redis;
  // Fail fast instead of queueing: a command while disconnected rejects, so /ready reports `failed` at once.
  return new Redis({
    host,
    port,
    db,
    ...(tls ? { tls: {} } : {}),
    password: config.redisPassword,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: 2000,
    // The ready check runs INFO, which the ACL denies (@dangerous); a connection counts once it is up.
    enableReadyCheck: false,
    retryStrategy: (attempt: number) => Math.min(attempt * 200, 2000),
  });
}

async function disconnect(redis: Redis): Promise<void> {
  if (redis.status === 'ready') {
    const quit = redis.quit().then(
      () => true,
      () => false,
    );
    const late = new Promise<false>((resolve) => {
      setTimeout(() => {
        resolve(false);
      }, QUIT_TIMEOUT_MS).unref();
    });
    if (await Promise.race([quit, late])) return;
  }
  redis.disconnect();
}

/** The mock adapter of @lfc/providers; expectations that do not parse stop the start like any configuration error. */
function mockAdapter(config: ClaimExtractorConfig): ModelAdapter {
  const { mock } = config;
  if (mock === undefined) throw new ConfigError('MOCK_EXPECTATIONS_FILE', 'is required');
  // Only the file's content is a configuration error; a failure of the mock itself is not blamed on the file.
  let expectations: ReturnType<typeof parseExpectations>;
  try {
    expectations = parseExpectations(mock.expectations);
  } catch {
    throw new ConfigError('MOCK_EXPECTATIONS_FILE', 'must hold one valid label per line');
  }
  return createMockClaimExtractor({ ...mock, expectations });
}

/** The Topic Extractor's mock adapter; loadConfig sets its settings whenever it configures the Topic Extractor. */
function topicMockAdapter(config: TopicExtractorConfig): ModelAdapter {
  if (config.mock === undefined) throw new ConfigError('MODEL_ADAPTER', 'must be mock');
  return createMockTopicExtractor(config.mock);
}

function pipelinesOf(
  config: DetectionConfig,
  adapters: { readonly claim: ModelAdapter | undefined; readonly topic: ModelAdapter | undefined },
  redis: Redis,
  logger: Logger,
): ClosableSessionPipelines | undefined {
  const { claim: adapter, topic: topicAdapter } = adapters;
  if (config.claimExtractor === undefined || adapter === undefined) return undefined;
  const topic = config.topicExtractor;
  return createSessionPipelines({
    ...(topic === undefined || topicAdapter === undefined
      ? {}
      : { topic: { config: topic, adapter: topicAdapter } }),
    config: config.claimExtractor,
    parameters: config.turnParameters,
    lifetimeSeconds: config.sessionLifetimeSeconds,
    adapter,
    records: createSessionRecords(redis),
    logger,
  });
}

export async function startDetection(options: DetectionOptions): Promise<void> {
  const logger = createLogger({ service: 'detection', write: options.write });
  const exit =
    options.exit ??
    ((code: number) => {
      process.exit(code);
    });
  let config: DetectionConfig;
  let adapter: ModelAdapter | undefined;
  let topicAdapter: ModelAdapter | undefined;
  try {
    config = await loadConfig(options.env);
    adapter = config.claimExtractor === undefined ? undefined : mockAdapter(config.claimExtractor);
    topicAdapter =
      config.topicExtractor === undefined ? undefined : topicMockAdapter(config.topicExtractor);
  } catch (error) {
    // A ConfigError names its variable on stderr; anything else is a bug at start and logs the class of its error.
    logger.log(
      error instanceof ConfigError
        ? { event: 'config.invalid' }
        : { event: 'config.invalid', reason: errorCode(error) },
    );
    writeConfigError('detection', error);
    exit(1);
    return;
  }

  // The effective Session lifetime, once (review S-H8); the closed log field set carries it as a duration.
  logger.log({ event: 'session.lifetime', durationMs: config.sessionLifetimeSeconds * 1000 });
  const redis = connect(config);
  // Logged on change only and without the error text, which names host and port.
  let reachable: boolean | undefined;
  const report = (now: boolean): void => {
    if (now !== reachable) logger.log({ event: now ? 'redis.connected' : 'redis.unreachable' });
    reachable = now;
  };
  redis.on('ready', () => {
    report(true);
  });
  redis.on('error', () => {
    report(false);
  });

  const pipelines = pipelinesOf(config, { claim: adapter, topic: topicAdapter }, redis, logger);
  await runService({
    port: config.port,
    logger,
    checks: { redis: () => redis.ping() },
    routes: createSessionRoutes({
      store: createSessionStore(redis, {
        lifetimeSeconds: config.sessionLifetimeSeconds,
        byteBudget: config.sessionByteBudget,
        maxSessions: config.maxSessions,
      }),
      logger,
      pipelines,
    }),
    // The Sessions' calls end first: they write to the detection stream over this connection.
    close: async () => {
      await pipelines?.close();
      await disconnect(redis);
    },
    signals: options.signals,
    exit,
  });
}

if (import.meta.main) await startDetection({ env: process.env });
