// Public interface of @lfc/inputs: the two replay Inputs. Each returns contract-valid Segments for one Session as an
// async iterable the consumer pulls (simulated clock, src/replay.ts).
export { referenceTranscriptInput, TranscriptError } from './reference-transcript.ts';
export { type Diagnosis, RecordingError, sttRecordingInput } from './stt-recording.ts';
