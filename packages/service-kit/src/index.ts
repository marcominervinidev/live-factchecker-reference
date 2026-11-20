// Public interface of @lfc/service-kit: only what services import. The test helper lives under `./testing`.
export { createLogger, type Logger, writeConfigError } from './logger.ts';
export {
  ConfigError,
  loadServiceConfig,
  readSecretFile,
  requireEnv,
  type Env,
  type ServiceConfig,
} from './config.ts';
export { errorCode, isProgrammingError } from './error-code.ts';
export { runService, type Signals } from './lifecycle.ts';
export {
  createModelCallRecorder,
  type ModelCall,
  type ModelCallRecorder,
  type SessionCounter,
  type SessionTotals,
} from './model-call.ts';
